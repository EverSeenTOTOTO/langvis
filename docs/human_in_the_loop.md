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
                              POST /api/human-input/:conversationId
                                              ↓
                              工具轮询检测到提交，返回结果
                                              ↓
                              Agent 继续执行
```

## 设计考量

### 1. Key 的选择：conversationId vs requestId

**最终选择：conversationId**

考量：
- 项目设计假定单一 conversation 同时只有一个进行中的消息流
- 使用 conversationId 简化前端逻辑，无需追踪额外 ID
- 前一次提交后自动清理，下一次可复用

如果未来需要支持一次 Agent 执行中多次人工介入，可扩展为 `conversationId:messageId` 或 `requestId`。

### 2. 等待机制：轮询 vs 持久化恢复

**最终选择：轮询（保持 SSE 连接）**

对比：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 轮询 | 实现简单，执行上下文完整保留 | 连接超时风险，占用资源 |
| 持久化恢复 | 支持跨天等待，高可用 | 实现复杂，需要状态恢复机制 |

选择轮询的原因：
- 个人使用，单进程部署，复杂度足够
- SSE 已有心跳机制（10秒），连接稳定
- 指数退避轮询减少 Redis 访问频率

### 3. 轮询间隔：指数退避

间隔计算：`min(maxMs, baseMs * 2^attempt)`

默认参数：
- `baseMs`: 60秒
- `maxMs`: 30分钟

间隔序列：60s → 2min → 4min → 8min → 16min → 30min → 30min...

优点：
- 初期快速响应（用户可能很快填写）
- 后期减少资源占用

### 4. 存储方案：独立 Store vs Redis

**最终选择：直接使用 Redis + 前缀**

考量：
- 项目已有 Redis 连接，无需额外抽象层
- 使用 `human_input:` 前缀隔离数据
- 未来大规模部署天然支持

## API

### 工具输入

```typescript
{
  message: string;        // 提示用户的信息
  formSchema: JSONSchema; // 表单 Schema（AJV 格式）
  timeout?: number;       // 超时时间（毫秒），默认 1 小时
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

- `GET /api/human-input/:conversationId` - 查询等待状态
- `POST /api/human-input/:conversationId` - 提交表单数据

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
description: '当任务涉及敏感操作、不确定用户意图、或需要用户确认决策时调用此工具...'
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
      formSchema: { type: 'boolean' }
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
