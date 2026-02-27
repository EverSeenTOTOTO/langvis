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
                              Redis Pub/Sub 通知 Tool 继续执行
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

### 2. 等待机制：Pub/Sub + 兜底轮询

**最终选择：Redis Pub/Sub（主） + 轮询（兜底）**

对比：

| 方案       | 优点                         | 缺点                       |
| ---------- | ---------------------------- | -------------------------- |
| 纯轮询     | 实现简单                     | 响应延迟，资源占用         |
| Pub/Sub    | 即时响应，无等待时零资源消耗 | 需要额外 Redis 连接        |
| 持久化恢复 | 支持跨天等待，高可用         | 实现复杂，需要状态恢复机制 |

选择 Pub/Sub 的原因：

- 即时响应：用户提交后毫秒级通知 Tool 继续
- 零轮询开销：等待期间不消耗 Redis 资源
- 兜底机制：每 30s 检查一次 Redis，防止 Pub/Sub 意外失败

**为什么需要两个 Redis 连接？**

Redis 协议规定：客户端执行 `SUBSCRIBE` 后进入订阅状态，只能接收推送消息，不能再发送其他命令（如 SET/GET）。因此需要：

- `redis`：普通客户端，用于 SET/GET/PUBLISH 等命令
- `redisSubscriber`：订阅客户端，专用于 SUBSCRIBE 接收消息

### 3. 超时与轮询参数

```typescript
timeout = 300_000; // 5 分钟总超时
POLL_INTERVAL = 30_000; // 30 秒兜底轮询间隔
```

流程：

```
while (未超时) {
  subscribe(channel);                    // 订阅频道
  await Promise.race([
    notifyPromise,                       // 等待 Pub/Sub 通知（主要）
    sleepWithSignal(30s)                 // 或 30s 超时（兜底）
  ]);
  check Redis;                           // 确认提交状态
}
```

### 4. 存储方案：Redis Key + Pub/Sub Channel

使用相同前缀 `human_input:`：

- **Key-Value 存储**：`human_input:{conversationId}` 存储表单数据和提交状态
- **Pub/Sub 频道**：`human_input:{conversationId}` 用于即时通知

```typescript
// Tool 端
await redis.set(key, JSON.stringify({ submitted: false, ... }));
await redisSubscriber.subscribe(key, callback);

// Controller 端
await redis.set(key, JSON.stringify({ submitted: true, result: data }));
await redis.publish(key, 'submitted');
```

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

- `GET /api/human-input/:conversationId` - 查询等待状态（用于页面刷新时检查）
- `POST /api/human-input/:conversationId` - 提交表单数据，并发布 Pub/Sub 通知

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
组件挂载时调用 GET /api/human-input/:conversationId 检查提交状态
        ↓
┌─────────────────────────────────────────────────────────┐
│ 已提交 → 显示 "Processing..." 等待 SSE 后续事件         │
│ 未提交 → 渲染表单                                       │
└─────────────────────────────────────────────────────────┘
        ↓
用户填写表单提交
        ↓
ChatStore.submitHumanInput() → POST /api/human-input/:conversationId
        ↓
显示 "Processing..." 防止重复提交
        ↓
Controller 发布 Redis Pub/Sub 通知
        ↓
Tool 收到通知继续执行，yield tool_result
        ↓
EventRenderer 收到 SSE 事件，HumanInputForm 不再渲染
```

### 防重复提交

1. **提交前**：检查服务端状态 `GET /api/human-input/:conversationId`
2. **提交后**：本地状态标记已提交，显示 "Processing..."
3. **页面刷新**：重新检查服务端状态，已提交则显示 "Processing..."

### 组件

- **SchemaField** (`src/client/components/SchemaField/`) - 共享组件，将 JSON Schema 渲染为 antd 表单字段
- **HumanInputForm** (`src/client/components/HumanInputForm/`) - 人工输入表单，调用 ChatStore API
- **EventRenderer** - 检测 `tool_progress` + `human_in_the_loop_tool` + `awaiting_input` 状态时渲染表单
