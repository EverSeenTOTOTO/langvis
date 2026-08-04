# HumanInTheLoop Tool

## 概述

HumanInTheLoop 是一个允许 Agent 在执行过程中请求人工输入的工具。当 Agent 遇到需要用户确认、决策或补充信息的场景时，可以调用此工具暂停执行，等待用户提交表单后继续。

## 设计思路

### 为什么需要这个工具

LLM Agent 在自主执行任务时，某些场景需要人工介入：

- 敏感操作确认（删除文件、发送邮件等）
- 不确定用户意图时的澄清
- 需要用户提供额外参数
- 多选项决策

### 核心流程

```
Agent 执行 → 调用 HumanInTheLoop → yield awaiting_input 事件
                                              ↓
                              前端渲染表单，用户填写提交
                                              ↓
                              POST /api/human-input/:runId
                                              ↓
                              进程内通知（resolve 等待中的 Deferred）
                                              ↓
                              Agent 继续执行
```

## 设计考量

### 1. Key 的选择：runId

**最终选择：runId（AgentRun 聚合 id）**

考量：

- 待输入状态属于具体的 AgentRun，AskUser 在其运行期间阻塞等待，键天然对应该 runId
- web 提交端经 `executor.getActiveRun(runId)` 直接定位内存聚合，无需额外翻译
- 前端从 `awaitingInput` 投影拿到 runId 即可提交/查询，不分 conv 与子 agent

如果未来需要支持一次 Agent 执行中多次人工介入，可扩展为 `runId:reqIndex` 或独立 requestId。

### 2. 状态位置：AgentRun 聚合（运行期协调态）

**最终选择：状态放在 `AgentRun` 聚合上，作为运行期协调态（同 `abortController`，不入事件流）。**

AskUser（写入）与 web（提交）都命中同一个内存聚合实例：

- AskUser 经 `ctx` 拿到 runId，通过注入的 `AgentRunExecutor.getActiveRun(runId)` 取到活跃聚合。
- web 提交端（HTTP controller）同样注入 `AgentRunExecutor`，`getActiveRun(runId)` 够到同一个实例后调聚合的 `submitInput` / `inputStatus`。

这与 `cancel` 的既有路径一致——web 侧的取消就是靠 `executor.cancel(runId)` 定位内存聚合。

等待用 Deferred 实现：`submitInput` 同步改状态并 resolve 聚合上等待中的 waiter，AskUser 侧立即收到结果。无需 Redis、无需轮询，也不需要单独的 store / port 抽象。

### 3. 超时与中止参数

```typescript
timeout = 300_000; // 5 分钟总超时
```

流程：

```
AskUser（run 内）:
  run = executor.getActiveRun(runId)
  run.beginAwaitInput({ formSchema, message })   // 登记待输入
  yield awaiting_input 事件                        // 前端据以渲染表单
  await run.waitForInput(timeout, signal)          // Deferred，提交即 resolve

Controller（web）:
  executor.getActiveRun(runId)?.submitInput(data)  // 同步 write + resolve waiter
```

- 提交路径 resolve waiter 后 AskUser 立即读到结果，无轮询。
- 超时：`waitForInput` 内部 setTimeout，到点 resolve `{ submitted: false }`。
- 中止：监听 AbortSignal，中止时 resolve `{ submitted: false }`，由 AskUser 检测 `signal.aborted` 后抛出。

### 4. HTTP 寻址：以 runId 为键

端点 `GET/POST /api/human-input/:runId` 直接以 runId 寻址，无需 messageId→runId 翻译，因此不存在对 MessageRepository 的依赖。前端从 run_view 的 `awaitingInput` 投影（含 `runId` 字段）取得 runId 进行提交/查询。

## API

### 工具输入

```typescript
{
  message: string;        // 提示用户的信息
  formSchema: JSONSchema; // 表单 Schema，必须是 type: "object"，字段定义在 properties 中
  timeout?: number;       // 超时时间（毫秒），默认 5 分钟
}
```

**formSchema 示例：**

```typescript
// 简单确认
{
  type: 'object',
  properties: {
    confirmed: { type: 'boolean', title: '确认?' }
  }
}

// 文本输入
{
  type: 'object',
  properties: {
    name: { type: 'string', title: '姓名' }
  }
}

// 多选项
{
  type: 'object',
  properties: {
    choice: { type: 'string', enum: ['选项1', '选项2'], title: '请选择' }
  }
}

// 多字段
{
  type: 'object',
  properties: {
    name: { type: 'string', title: '姓名' },
    age: { type: 'number', title: '年龄' }
  }
}
```

### 工具输出

```typescript
{
  submitted: boolean;           // 是否已提交
  data?: Record<string, unknown>; // 用户提交的表单数据
}
```

### HTTP 端点

- `GET /api/human-input/:runId` - 查询等待状态（用于页面刷新时检查）
- `POST /api/human-input/:runId` - 提交表单数据，并通知等待中的 Tool 继续

### SSE 事件

工具执行时会 yield `tool_progress` 事件：

```typescript
{
  type: 'tool_progress',
  toolName: 'human_in_the_loop_tool',
  data: {
    status: 'awaiting_input',
    conversationId: string,
    message: string,
    schema: JSONSchema
  }
}
```

## 引导 Agent 调用

### 方式一：工具描述引导

在工具的 `description` 中明确触发条件：

```typescript
description: '当任务涉及敏感操作、不确定用户意图、或需要用户确认决策时调用此工具...';
```

缺点：依赖 LLM 自主判断，不可靠。

### 方式二：System Prompt 规则

在 Agent 的 system prompt 中添加明确规则：

```
规则：
- 涉及删除/修改数据 → 必须调用 human_in_the_loop
- 不确定用户意图 → 调用 human_in_the_loop
- 金额/支付相关 → 必须确认
```

### 方式三：工具链强制注入（推荐）

在特定工具执行前后自动注入确认逻辑：

```typescript
class DeleteFileTool {
  async *call(input, ctx) {
    // 执行前自动触发确认
    const confirmed = yield* this.delegateTo('human_in_the_loop', {
      message: `确认删除文件 ${input.filename}?`,
      formSchema: { type: 'boolean' },
    });
    if (!confirmed.submitted) return { cancelled: true };
    // 继续执行...
  }
}
```

## 未来扩展

1. **表单类型扩展** - 支持更丰富的 UI 控件（文件上传、图片选择等）
2. **多轮确认** - 支持一次执行中多次人工介入
3. **超时回调** - 超时后执行默认行为而非简单返回
4. **持久化恢复** - 如果需要跨天等待，可实现状态持久化 + 恢复机制

## 前端实现

### 数据流

```
SSE tool_progress 事件
        ↓
EventRenderer 检测最后一个事件为 human_in_the_loop_tool + awaiting_input
        ↓
渲染 HumanInputForm 组件
        ↓
组件挂载时调用 GET /api/human-input/:runId 检查提交状态
        ↓
┌─────────────────────────────────────────────────────────┐
│ 已提交 → 显示 "Processing..." 等待 SSE 后续事件         │
│ 未提交 → 渲染表单                                       │
└─────────────────────────────────────────────────────────┘
        ↓
用户填写表单提交
        ↓
ChatStore.submitHumanInput() → POST /api/human-input/:runId
        ↓
显示 "Processing..." 防止重复提交
        ↓
Controller 提交到 HumanInputStore（resolve 等待中的 Tool）
        ↓
Tool 收到通知继续执行，yield tool_result
        ↓
EventRenderer 收到 SSE 事件，HumanInputForm 不再渲染
```

### 防重复提交

1. **提交前**：检查服务端状态 `GET /api/human-input/:runId`
2. **提交后**：本地状态标记已提交，显示 "Processing..."
3. **页面刷新**：重新检查服务端状态，已提交则显示 "Processing..."

### 组件

- **SchemaField** (`src/client/components/SchemaField/`) - 共享组件，将 JSON Schema 渲染为 antd 表单字段
- **HumanInputForm** (`src/client/components/HumanInputForm/`) - 人工输入表单，调用 ChatStore API
