# Chat 架构文档

基于 SSE (Server-Sent Events) 的流式对话系统架构，支持断线重连与 Agent 执行解耦。

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                        │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │   ChatStore     │───►│ ConversationState│    │ deriveMessageState()  │  │
│  │   (MobX)        │    │ (per-conversation)│    │ (render state)        │  │
│  └────────┬────────┘    └────────┬─────────┘    └───────────────────────┘  │
│           │                      │                                          │
│           │ EventSource          │ phase (only)                             │
│           │                      │                                          │
│           └──────────────────────┴────────────────────────────────────────  │
│                                │                                            │
│                                ▼                                            │
│                      ┌─────────────────────┐                               │
│                      │ ConversationStore   │                               │
│                      │ messages[conversationId]                            │
│                      │ (唯一数据源，MobX 观测) │                           │
│                      └─────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          SSE Channel (SSEMessage)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend                                         │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │ ChatController  │───►│   ChatService    │───►│    ChatSession        │  │
│  │ (HTTP routes)   │    │ (session registry)│    │ (message, SSE, phase) │  │
│  └───────┬─────────┘    └──────────────────┘    └───────────┬───────────┘  │
│          │                                                 │              │
│          │                                                 │ ctx          │
│          ▼                                                 ▼              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │    Agent        │───►│ ExecutionContext │    │       Tool            │  │
│  │ (LLM orchestration)   │ (signal, events)│    │ (capabilities)        │  │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ BackgroundTaskService (定时任务 / webhook，无 SSE)                   │    │
│  │   └─ 直接驱动 Agent 循环，事件处理自定义（日志/回调）                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 后端架构

### 2.1 ExecutionContext - 纯执行上下文

`ExecutionContext` 是 Agent 执行过程中的轻量上下文，**仅提供控制信号和事件工厂方法**，不持有业务数据（如 message）。

**设计原则：** 保持轻量和纯粹——只包含执行控制（AbortController）、追踪标识（traceId）、序号生成、callId 栈管理。不涉及数据持久化、内容累积、SSE 发送等业务逻辑。

**核心职责：**

| 职责        | 方法/属性                                        | 说明                        |
| ----------- | ------------------------------------------------ | --------------------------- |
| 控制信号    | `signal` / `abort(reason)`                       | 取消执行                    |
| 追踪标识    | `traceId`                                        | 日志追踪，通常为 message.id |
| 事件工厂    | `agentStartEvent()` / `agentStreamEvent()` ...   | 创建事件对象，不存储        |
| 序号生成    | `nextSeq()` (internal)                           | 自动递增，保证事件顺序      |
| callId 管理 | `pushCallId()` / `popCallId()` / `currentCallId` | 关联 tool_call 与后续事件   |

**关键点：事件工厂只返回对象，不持久化**

```typescript
agentStreamEvent(content: string): AgentEvent {
  return { type: 'stream', content, seq: this.nextSeq(), at: Date.now() };
  // 不调用 appendContent，内容累积由 ChatSession 负责
}
```

**关键文件：** `src/server/core/ExecutionContext.ts`

### 2.2 ChatSession - SSE 会话管理

`ChatSession` 是 SSE 实时对话场景的会话管理单元，持有 message、SSE 连接、phase 状态机，并驱动 Agent 执行循环。

**设计原则：** 会话级数据内聚——message、SSE 连接、phase 状态都属于"会话"概念，由 ChatSession 统一管理。执行循环也放这里，因为事件处理逻辑（累积内容、持久化事件、发送 SSE）与会话强相关。

**Phase 状态机：**

```
         initSSE()          run()
waiting ──────────────► running ──────────► done
    │                        │
    │ idle timeout           │ final/error/cancel
    │ handleDisconnect()     │ cleanup()
    ▼                        ▼
   done ◄────────────────── done
```

**核心职责：**

| 职责     | 方法/属性                       | 说明                                 |
| -------- | ------------------------------- | ------------------------------------ |
| 消息管理 | `message`                       | 持有助手消息，累积内容、持久化事件   |
| 执行编排 | `run(agent, memory, config)`    | 驱动 Agent 循环，处理事件            |
| 事件处理 | `handleEvent(event)` (internal) | 累积内容 + 持久化事件 + 发送 SSE     |
| 状态转换 | `transition()` (internal)       | 校验合法转换                         |
| 取消信号 | `cancel(reason)`                | 代理到 `ctx.abort()`                 |
| 断线处理 | `handleDisconnect()`            | 按 phase 分路径处理                  |
| SSE 绑定 | `bindConnection(conn)`          | 绑定 SSE 连接                        |
| 资源清理 | `cleanup()`                     | 关闭连接、清理定时器、持久化 message |

**事件处理逻辑：**

```typescript
private handleEvent(event: AgentEvent): void {
  // 1. 累积 stream 内容到 message
  if (event.type === 'stream') {
    this.message.content += event.content;
  }
  // 2. 持久化非 stream 事件到 message.meta.events
  if (event.type !== 'stream') {
    this.message.meta.events.push(event);
  }
  // 3. 发送 SSE
  this.sendSSE(event);
}
```

**关键文件：** `src/server/core/ChatSession.ts`

### 2.3 ChatService - 会话注册表

管理所有活跃 session 的注册与销毁，提供原子占位操作。不介入 Agent 执行细节。

**核心方法：**

| 方法                                      | 说明                       |
| ----------------------------------------- | -------------------------- |
| `acquireSession(conversationId, message)` | 原子占位，防止 TOCTOU 竞态 |
| `getSession(conversationId)`              | 获取现有 session           |
| `runSession(session, ...)`                | 委托 `session.run()` 执行  |

**生命周期：**

```
acquireSession(conversationId, message) → session(phase=waiting)
       ↓
bindConnection(sseConnection)
       ↓
runSession() → session.run(agent, memory, config) → phase=running
       ↓
session.run() 内部: for await → handleEvent → cleanup → phase=done
       ↓
onDispose() → delete from Map, clean Redis
```

**关键文件：** `src/server/service/ChatService.ts`

### 2.4 BackgroundTaskService - 后台任务服务

用于定时任务、webhook 等无 SSE 连接的 Agent 执行场景。不持有 message，事件直接记录日志或回调。

**核心方法：**

| 方法                                      | 说明                  |
| ----------------------------------------- | --------------------- |
| `runTask(agent, memory, config, traceId)` | 执行 Agent 并处理事件 |

**使用示例：**

```typescript
const taskService = new BackgroundTaskService();
await taskService.runTask(agent, memory, config, traceId, {
  onEvent: event => logger.info({ event, traceId }),
  onComplete: () => {
    /* 回调通知 */
  },
});
```

**关键文件：** `src/server/service/BackgroundTaskService.ts`

### 2.5 ChatController - HTTP 路由

**路由设计：**

| 路由                               | 方法 | 说明          |
| ---------------------------------- | ---- | ------------- |
| `/api/chat/sse/:conversationId`    | GET  | 建立 SSE 连接 |
| `/api/chat/start/:conversationId`  | POST | 启动 Agent    |
| `/api/chat/cancel/:conversationId` | POST | 取消执行      |

**initSSE 流程：**

```
1. acquireSession() → 可返回 409 拒绝
2. initSSEConnection() → writeHead(200)
3. bindConnection() → 绑定到 session
4. req.on('close') → session.handleDisconnect()
```

**start 流程：**

```
1. getSession() + phase 检查
2. resolve agent
3. buildMemory() → memory.store() 持久化 system prompt + 用户消息
4. batchAddMessages() → 创建空的助手消息占位（HTTP 响应前）
5. return 200 + messageId
6. runSession() → 异步执行（内部委托 session.run()）
```

**关键文件：** `src/server/controller/ChatController.ts`

---

## 3. 前端架构

### 3.1 ChatStore - 状态管理入口

管理所有会话状态，提供统一访问接口。

**核心 Getters：**

| Getter                     | 说明                 |
| -------------------------- | -------------------- |
| `isCurrentLoading`         | 当前会话是否在加载中 |
| `currentPhaseError`        | 当前会话的错误信息   |
| `getState(conversationId)` | 获取指定会话状态     |

**数据流：**

```
SSE 'stream' event → ChatStore.appendMessageContent() → 直接更新 messages[last].content
SSE 'final' event → 刷新 messages (获取后端最终状态) → 进入 idle
```

消息内容直接从 SSE 事件更新到 `messages` 数组，无中间缓冲区。

**核心方法：**

| 方法                           | 说明                              |
| ------------------------------ | --------------------------------- |
| `startChat(params)`            | 启动对话（后端触发 `runSession`） |
| `cancelChat(params)`           | 取消对话                          |
| `connectToSSE(conversationId)` | 建立 SSE 连接                     |

**关键文件：** `src/client/store/modules/chat.ts`

### 3.2 ConversationState - 会话状态容器

每个会话独立的 MobX 状态容器。**仅管理 phase 状态机和 SSE 连接**，无 typewriter 逻辑。

**状态字段：**

| 字段        | 类型                | MobX 观测 | 说明         |
| ----------- | ------------------- | :-------: | ------------ |
| phase       | ChatPhase           |    ✅     | 状态机阶段   |
| phaseError  | string \| null      |    ✅     | 错误信息     |
| eventSource | EventSource \| null |    ❌     | SSE 连接句柄 |

**Phase 状态机：**

```
         startChat()
 idle ──────────────► connecting
  ▲                       │
  │                       │ 'start' event
  │                       ▼
  │                   streaming
  │                       │
  │         ┌─────────────┼──────────────┐
  │         │             │              │
  │         ▼             ▼              ▼
  │        idle        error        cancelled
  │      (final)          │              │
  │                       │              │
  └───────────────────────┴──────────────┘
```

**关键文件：** `src/client/store/modules/ConversationState.ts`

### 3.3 deriveMessageState - 消息渲染状态派生

从 `message.meta.events` 派生渲染状态，支持时序分析和 Agent 自定义渲染。

**派生状态：**

| 字段              | 说明                                                      |
| ----------------- | --------------------------------------------------------- |
| hasContent        | 消息是否有文本内容                                        |
| hasEvents         | 是否有事件                                                |
| isTerminal        | 是否已结束 (final/error/cancelled)                        |
| isAwaitingContent | Agent 已启动但尚无可见产出（无 content、无 pending 工具） |
| toolCallTimeline  | 按 seq 排序的工具调用时间线                               |
| pendingToolCalls  | 进行中的工具调用                                          |
| hasPendingTools   | 是否有工具正在执行                                        |
| thoughts          | 思考过程事件                                              |
| rawEvents         | 原始事件数组，供特殊场景使用                              |

**ToolCallTimeline 结构：**

```typescript
type ToolCallTimeline = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  seq: number; // tool_call 的全局序列号，用于排序
  at: number; // 时间戳
  status: 'pending' | 'done' | 'error';
  output?: unknown;
  error?: string;
  progress: Array<{ data: unknown; seq: number; at: number }>;
};
```

**渲染架构（两级状态派生）：**

```
deriveMessageState(msg) → MessageRenderState（通用：hasContent, isAwaitingContent, toolCallTimeline...）
         ↓
deriveXxxState(state)   → Agent 专属状态（如 ReAct: isProcessing, awaitingInput; GF: isTtsPending）
         ↓
AgentRenderer(msg, state) → { content, showBubbleLoading }
         ↓
AssistantMessage 渲染 Bubble
```

通用语义（如 `isAwaitingContent`）由 `deriveMessageState` 统一计算；Agent 特有语义由各 renderer 内部的 `deriveXxxState` 计算，避免通用层膨胀。

**关键文件：**

- `src/shared/utils/deriveMessageState.ts`
- `src/client/pages/Home/components/agentRenderers.tsx`

---

## 4. SSE 消息协议

### 4.1 SSEMessage 联合类型

SSE 通道传输的顶层类型：

```typescript
type SSEMessage =
  | { type: 'connected'; conversationId: string } // 握手确认
  | { type: 'heartbeat' } // 心跳
  | { type: 'session_error'; error: string } // 会话级错误
  | AgentEvent; // 业务事件
```

### 4.2 AgentEvent 业务事件

```typescript
type AgentEvent =
  | { type: 'start'; seq: number; at: number }
  | { type: 'thought'; content: string; seq: number; at: number }
  | {
      type: 'tool_call';
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_progress';
      callId: string;
      toolName: string;
      data: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      output: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_error';
      callId: string;
      toolName: string;
      error: string;
      seq: number;
      at: number;
    }
  | { type: 'stream'; content: string; seq: number; at: number }
  | { type: 'final'; seq: number; at: number }
  | { type: 'cancelled'; reason: string; seq: number; at: number }
  | { type: 'error'; error: string; seq: number; at: number };
```

### 4.3 Tool 执行模式

工具执行遵循简洁的 generator 模式：

**工具职责：**

- `yield` - 发送 progress 事件（中间过程）
- `return` - 返回执行结果
- `throw` - 抛出错误

**Agent 职责：**

- 生成 `tool_call` 事件（调用开始）
- 透传工具的 progress 事件
- 生成 `tool_result` 或 `tool_error` 事件（调用结束）

### 4.4 调用模式

**Agent 调用工具：**

```typescript
// Agent 负责管理 callId 生命周期和事件边界
yield ctx.agentToolCallEvent(tool, input); // push callId, emit tool_call
const result = yield * tool.call(input, ctx); // 透传 progress
yield ctx.agentToolResultEvent(tool, result); // pop callId, emit tool_result
```

**工具内部调用子工具：**

```typescript
// 直接 yield*，简单透传，generator 的 return 就是结果
const subResult = yield * subTool.call(input, ctx);
```

**错误处理：**

```typescript
// 工具抛出错误，Agent 捕获并生成 tool_error 事件
try {
  const result = yield * tool.call(input, ctx);
  yield ctx.agentToolResultEvent(tool, result);
} catch (error) {
  yield ctx.agentToolErrorEvent(tool, error.message);
}
```

### 4.5 callId 关联机制

`callId` 用于关联 `tool_call` 与后续事件：

```
tool_call(callId='tc_abc')
    │
    ├── tool_progress(callId='tc_abc')  // 可多次
    │
    └── tool_result(callId='tc_abc') / tool_error(callId='tc_abc')  // 终态
```

**栈式 callId 管理：**

`ExecutionContext` 内部通过 `callIdStack: string[]` 管理 callId 的生命周期：

| 操作                       | 栈行为            |
| -------------------------- | ----------------- |
| `agentToolCallEvent()`     | **push** callId   |
| `agentToolResultEvent()`   | 使用栈顶，**pop** |
| `agentToolErrorEvent()`    | 使用栈顶，**pop** |
| `agentToolProgressEvent()` | 使用栈顶          |

**嵌套调用示例：**

```
agentToolCallEvent('analysis')      → stack: [tc_analysis]
  analysis 内部调用 meta_extract:
  agentToolProgressEvent('meta')    → 使用 tc_analysis
  return metaResult                 → 不影响栈
agentToolResultEvent('analysis')    → stack: []
```

关键点：工具内部调用子工具不会创建新的 callId scope，所有子工具的 progress 都属于父工具的 callId。

**嵌套调用示例：**

```
agentToolCallEvent('a')      → stack: [a]
agentToolCallEvent('b')      → stack: [a, b]
agentToolProgressEvent('meta')    → 使用 b 做完callId
agentToolResultEvent('b')    → stack: [a]
agentToolResultEvent('b')    → stack: []
```

---

## 5. 关键交互流程

### 5.1 正常对话流程

```
Frontend                    Backend                          Agent
   │                     Controller  ChatService  ChatSession   │
   │                           │          │           │         │
   │──GET /sse/{id}───────────►│          │           │         │
   │                           │──acquireSession()───►│         │
   │◄──connected event─────────│          │           │         │
   │                           │          │           │         │
   │──POST /start/{id}────────►│          │           │         │
   │                           │──buildMemory()       │         │
   │                           │  └─memory.store()    │         │
   │                           │──batchAddMessages()  │         │
   │◄──200 + messageId─────────│          │           │         │
   │                           │──runSession()───────►│         │
   │                           │          │       run()────────►│
   │                           │          │           │         │
   │◄──start event─────────────│          │  sendEvent│◄─yield──│
   │◄──stream events───────────│          │  sendEvent│◄─yield──│
   │◄──final event─────────────│          │  sendEvent│◄─yield──│
   │                           │          │           │         │
   │                           │          │       cleanup()     │
   │                           │     onDispose()◄─────│         │
```

### 5.2 取消流程

```
Frontend                    Backend                          Agent
   │                     Controller           ChatSession      │
   │                           │                  │            │
   │──POST /cancel/{id}───────►│                  │            │
   │                           │──session.cancel()│            │
   │                           │                  │─ctx.abort()│
   │                           │                  │    run() break loop
   │◄──cancelled event─────────│                  │◄──finally──│
   │                           │              cleanup()        │
```

### 5.3 客户端断线流程

```
Client                      Backend                          Agent
   │                     Controller           ChatSession      │
   │                           │                  │            │
   │──disconnect──────────────►│                  │            │
   │                           │──req.on('close') │            │
   │                           │──session.handleDisconnect()   │
   │                           │                  │─cancel()   │
   │                           │                  │    run() break loop
   │                           │                  │◄──finally──│
   │                           │              cleanup()        │
```

---

## 6. 目录结构

```
src/
├── server/
│   ├── core/
│   │   ├── ChatSession.ts        # SSE 会话管理
│   │   ├── ExecutionContext.ts   # 纯执行上下文
│   │   ├── agent/                # Agent 实现
│   │   └── tool/                 # Tool 实现
│   ├── controller/
│   │   └── ChatController.ts     # HTTP 路由
│   └── service/
│       ├── ChatService.ts        # SSE 会话注册表
│       ├── BackgroundTaskService.ts  # 后台任务服务
│       └── SSEService.ts         # SSE 连接管理
│
├── client/
│   ├── pages/
│   │   └── Home/
│   │       └── components/
│   │           ├── AssistantMessage.tsx    # 消息渲染入口
│   │           ├── agentRenderers.tsx      # Agent 渲染器注册表
│   │           └── AgentMessage/           # Agent 自定义渲染器
│   └── store/
│       └── modules/
│           ├── chat.ts                  # ChatStore
│           └── ConversationState.ts     # 会话状态
│
└── shared/
    ├── types/
    │   └── index.ts              # SSEMessage, AgentEvent
    └── utils/
        └── deriveMessageState.ts  # 消息渲染状态派生
```

---

## 7. 设计决策

### 7.1 为什么 ChatSession 同时拥有状态和行为？

早期设计中，SSE 连接、phase 等状态散落在 ChatService、SSEService 等多处，难以追踪单个 session 的全貌。第一次改造将状态内聚到 ChatSession，但执行循环（`startAgent`）仍留在 ChatService，导致 ChatSession 成为"持有状态却不拥有行为"的贫血容器，API 语态分裂（`cancel` 是主动动词，`onClientDisconnect` 是被动回调）。

当前设计将执行循环（`run()`）也移入 ChatSession，使其成为自治工作单元：**谁持有状态，谁就驱动行为**。ChatService 退化为纯 registry（Map 增删 + 依赖构建），不介入执行细节。

### 7.1.1 ChatSession vs ExecutionContext 的分离

| 维度     | ChatSession                               | ExecutionContext           |
| -------- | ----------------------------------------- | -------------------------- |
| 生命周期 | SSE 建连时创建                            | ChatSession 构造时创建     |
| 暴露面   | 仅 ChatService/Controller                 | 传递给所有 Agent/Tool      |
| 关注点   | 会话层（message、SSE、phase、Agent 循环） | 控制层（signal、事件工厂） |
| 持久化   | 在 cleanup() 时持久化 message             | 不持久化，仅创建事件对象   |

**为什么 message 放在 ChatSession 而不是 ExecutionContext？**

message 是会话级概念，与 SSE 连接、phase 状态同属一层。ExecutionContext 设计为轻量、纯粹的执行上下文，不应承载业务数据。这样 ExecutionContext 可以被后台任务复用，而 ChatSession 专注于 SSE 实时交互场景。

### 7.2 为什么 acquireSession 不接收 sseConnection？

`initSSEConnection()` 会立即 `writeHead(200)`，之后无法返回 409。因此必须先 acquire（可拒绝），再建连。

### 7.3 为什么按 phase 分路径取消？

| Phase                | 处理                | 原因              |
| -------------------- | ------------------- | ----------------- |
| connecting           | 仅前端清理          | 后端无 Agent 运行 |
| streaming            | 前端清理 + 通知后端 | Agent 正在运行    |
| idle/error/cancelled | 静默忽略            | 已结束            |

### 7.5 单进程约束

`sessions` Map 是进程内存，多节点部署需引入 sticky session 或 Redis-backed registry。

---

## 8. 取消时机分析

用户点击取消按钮时，系统可能处于不同阶段：

| 时机 | 描述                           | 前端取消动作                       | 后端取消动作                        | 刷新页面后     |
| ---- | ------------------------------ | ---------------------------------- | ----------------------------------- | -------------- |
| 1    | SSE 还在连接中                 | phase→cancelled，关闭 ES，刷新     | handleDisconnect()→cleanup()        | 无消息         |
| 2    | startChat 已响应，未收到 start | 调用 /cancel，刷新                 | ctx.abort()，发送 cancelled，持久化 | cancelled 状态 |
| 3    | 流式输出中（content 或 tool）  | 调用 /cancel，刷新                 | ctx.abort()，发送 cancelled，持久化 | cancelled 状态 |
| 4    | 上游流完成，SSE 传输中         | 调用 /cancel（可能返回 404），刷新 | 可能已 done，返回 404               | 最终状态       |
| 5    | SSE 传输完成，后端持久化中     | 幂等返回（isLoading=false）        | finalizeMessage() 完成              | final 状态     |
| 6    | 后端完成，通知前端过程中       | 幂等返回或 404                     | 已 done                             | final 状态     |

**幂等性保证**：

- 前端：`isLoading=false` 时 `cancelChat()` 直接返回
- 后端：`phase≠running` 时返回 404，前端静默忽略

---

## 9. 断线重连

### 9.1 设计目标

- **Agent 与 SSE 解耦**：Agent 执行不依赖 SSE 连接，断开不中断
- **持久化会话状态**：Redis 存储会话状态，支持跨实例/重启恢复
- **无缝重连**：用户断线后可重连到正在运行的会话
- **会话切换支持**：切换会话时断开 SSE，Agent 继续运行，切回时检测重连

### 9.2 会话状态持久化

**Redis Key:** `chat_session:{conversationId}`

```typescript
interface ChatSessionState {
  conversationId: string;
  phase: 'waiting' | 'running' | 'done';
  startedAt: number;
  agentId: string | null;
}
```

**Phase 含义：**

| Phase     | 含义           | Agent 状态 | SSE 状态 |
| --------- | -------------- | ---------- | -------- |
| `waiting` | 已建连，未启动 | 未启动     | 可能断开 |
| `running` | 执行中         | 正在运行   | 可能断开 |
| `done`    | 已结束         | 已完成     | 已关闭   |

**生命周期：**

| 时机       | 操作                                              |
| ---------- | ------------------------------------------------- |
| 创建会话   | `SET chat_session:{id} { phase: 'waiting', ... }` |
| 启动 Agent | `SET phase: 'running'`                            |
| 完成/取消  | `SET phase: 'done'`                               |
| 会话清理   | `DEL chat_session:{id}`                           |

### 9.3 后端 API

#### GET /api/chat/session/:conversationId

查询会话状态，用于前端判断是否需要重连。

**响应：**

```typescript
// 会话存在
{
  phase: 'waiting' | 'running' | 'done';
}

// 会话不存在（已结束或从未创建）
null;
```

#### GET /api/chat/sse/:conversationId

建立 SSE 连接。

**响应：**

| Redis 状态            | HTTP 状态 | 响应                             |
| --------------------- | --------- | -------------------------------- |
| 不存在                | 404       | `{ error: 'Session not found' }` |
| `done`                | 200       | `{ type: 'session_ended' }`      |
| `waiting` / `running` | 200       | 建立 SSE，发送 `connected` 事件  |

### 9.4 后端改造点

**ChatSession.send()：**

```typescript
// 改造前：SSE 不可写时中断 Agent
if (!this.send(event)) {
  ctx.abort('SSE connection lost');
  break;
}

// 改造后：继续执行，事件已持久化到 PendingMessage
if (!this.send(event)) {
  logger.warn(`SSE not connected for ${this.conversationId}, event persisted`);
  // 继续执行
}
```

**ChatSession.handleDisconnect()：**

```typescript
// 改造前：断开时取消 Agent
handleDisconnect(): void {
  if (this.phase === 'running') {
    this.cancel('Client disconnected');
  } else {
    this.cleanup();
  }
}

// 改造后：断开时持久化消息，Agent 继续
async handleDisconnect(): Promise<void> {
  logger.info(`SSE disconnected for ${this.conversationId}`);

  // 持久化当前消息状态（支持 human-in-the-loop 等场景）
  if (this.pendingMessage && this.phase === 'running') {
    await this.pendingMessage.persist();
  }

  // Agent 继续运行
}
```

**PendingMessage 新增 persist() 方法：**

```typescript
// src/server/core/PendingMessage.ts

class PendingMessage {
  private message: Message;

  // 断线时持久化当前状态
  async persist(): Promise<void> {
    await this.updateCallback(this.message);
  }

  // 最终持久化（Agent 完成时）
  async finalize(): Promise<void> {
    await this.updateCallback(this.message);
  }
}
```

**消息持久化时机：**

| 时机       | 方法         | 说明                           |
| ---------- | ------------ | ------------------------------ |
| SSE 断开   | `persist()`  | 持久化当前状态，Agent 继续运行 |
| Agent 完成 | `finalize()` | 最终持久化，清理资源           |

**ChatService.acquireSession()：**

```typescript
// 改造前：已有 running 会话时拒绝
if (existing?.phase === 'running') return null;

// 改造后：已有会话直接返回（支持重连）
if (existing) return existing;
```

### 9.5 重连场景

#### 场景一：页面刷新

```
页面刷新
    │
    ├─ GET /api/conversation/:id/messages  →  获取最新消息
    │
    └─ GET /api/chat/session/:id
            │
            ├─ null / done → 无需重连，渲染消息最终状态
            │
            └─ waiting / running
                    │
                    └─ 建立 SSE 连接
                            │
                            ├─ Agent 正在运行 → 继续接收事件
                            │
                            └─ Agent 等待输入 → 渲染表单（human_in_the_loop）
```

#### 场景二：切换会话

```
用户从会话 A 切换到会话 B
    │
    ├─ 断开会话 A 的 SSE 连接
    │     └─ 后端 Agent 继续运行，事件持久化到 DB
    │
    ├─ GET /api/conversation/:B/messages   →  获取会话 B 消息
    │
    └─ GET /api/chat/session/:B
            │
            ├─ null / done → 无需重连
            │
            └─ waiting / running
                    │
                    └─ 建立 SSE 连接
```

#### 场景三：切换浏览器标签页

```
用户切换到其他标签页
    │
    ├─ visibilitychange 事件触发
    │
    └─ 页面 hidden → 断开当前会话 SSE
           │
           └─ 后端 Agent 继续运行

用户切回标签页
    │
    ├─ visibilitychange 事件触发
    │
    └─ 页面 visible → 触发重连检测
           │
           └─ 同页面刷新流程
```

### 9.6 前端重连逻辑

```typescript
// src/client/store/modules/chat.ts

async activateConversation(conversationId: string): Promise<void> {
  // 查询会话状态
  const state = await this.getSessionState(conversationId);

  // null 或 done → 无需重连
  if (!state || state.phase === 'done') {
    return;
  }

  // waiting 或 running → 建立 SSE
  const session = this.acquireSession(conversationId);
  await session.connect();
}
```

**触发时机：**

```typescript
// src/client/store/modules/conversation.ts

reaction(
  () => this.currentConversationId,
  async (newId, oldId) => {
    // 断开旧会话的 SSE（不断开正在进行的 Agent）
    if (oldId) {
      chatStore.getSession(oldId)?.disconnect();
    }

    if (!newId) return;

    // 刷新消息
    await this.getMessagesByConversationId({ id: newId });

    // 检查是否需要重连
    await chatStore.activateConversation(newId);
  },
);
```

**标签页可见性监听：**

```typescript
// src/client/store/modules/chat.ts

private handleVisibilityChange = (): void => {
  const conversationId = this.conversationStore.currentConversationId;
  if (!conversationId) return;

  if (document.visibilityState === 'hidden') {
    this.getSession(conversationId)?.disconnect();
  } else {
    this.activateConversation(conversationId);
  }
}

// 注册监听
constructor() {
  document.addEventListener('visibilitychange', this.handleVisibilityChange);
}
```

### 9.7 Human-in-the-loop 重连

Human-in-the-loop 不需要特别逻辑，走同样的重连流程：

```
Agent 调用 human_in_the_loop，等待用户输入
    │
    ├─ 事件累积到 PendingMessage（内存）
    │
    └─ 用户断开 SSE（切换会话/关闭标签页）
           │
           ├─ handleDisconnect() 调用 persist()
           │     └─ 消息持久化到数据库（含 awaiting_input 状态）
           │
           └─ Agent 继续等待输入

用户重连/切回
    │
    ├─ GET /api/chat/session/:id → { phase: 'running' }
    │
    ├─ 建立 SSE 连接
    │
    ├─ 刷新消息列表
    │     └─ deriveMessageState() 检测 awaiting_input
    │
    └─ 渲染 HumanInputForm
           │
           └─ 用户提交 → Agent 继续执行
```

**关键点**：断开 SSE 时调用 `persist()`，确保 `tool_progress(status: 'awaiting_input')` 事件已持久化。

### 9.8 时序图

```
Frontend                    Backend Redis        Backend Agent
    │                           │                     │
    │──切换到会话 A──────────────│                     │
    │                           │                     │
    │──GET /api/chat/session/A─►│                     │
    │◄──{ phase: 'running' }────│                     │
    │                           │                     │
    │──GET /api/chat/sse/A─────────────────────────►  │
    │                           │                     │
    │◄──── SSE: connected ────────────────────────────│
    │                           │                     │
    │◄──── SSE: stream/tool_call ────────────────────│── Agent 继续执行
    │                           │                     │
    │──切换到会话 B──────────────│                     │
    │                           │                     │
    │──disconnect() 会话 A SSE   │                     │
    │                           │                     │
    │──GET /api/chat/session/B─►│                     │
    │◄──{ phase: 'done' }───────│                     │
    │                           │                     │
    │──无需重连                  │                     │
```

### 9.9 并发连接策略

当用户在多个标签页/设备访问同一会话时：

```
标签页 A：SSE 连接中，Agent 正在运行
    │
    └─ 标签页 B 打开同一会话
           │
           └─ GET /api/chat/sse/:id
                  │
                  └─ bindConnection() 绑定新 SSE
                         │
                         └─ 踢掉标签页 A 的 SSE
                                │
                                └─ 发送 session_replaced 事件
```

**策略：新连接踢掉旧连接**

```typescript
// ChatSession.bindConnection()
bindConnection(connection: SSEConnection): void {
  // 踢掉旧连接
  if (this.sseConnection) {
    this.sseConnection.send({ type: 'session_replaced' });
    this.sseConnection.close();
  }
  this.sseConnection = connection;
}
```

**前端处理 session_replaced：**

```typescript
// ChatSession.handleEvent()
case 'session_replaced':
  // 被新连接替换，断开本地 SSE
  this.transition('idle');
  this.closeEventSource();
  // 可选：提示用户"会话已在其他标签页打开"
  break;
```

---

## 10. Agent 会话触发机制

### 10.1 设计目标

- **通用触发函数**：点击按钮 → 新标签页打开会话 → 自动发起 Agent 对话
- **后端预创建**：后端创建会话和消息，前端只需"重连"
- **支持配置**：是否自动发送

### 10.2 API 设计

**POST /api/chat/resume/:conversationId**

会话和消息已创建，只需启动 Agent。

请求：无 body

响应：

```typescript
{
  success: boolean;
  messageId: string;
}
```

逻辑：

1. 验证会话存在且 Redis 状态为 'waiting'
2. 从数据库读取最新用户消息
3. 构建 Memory
4. 启动 Agent 执行
5. 更新 Redis 状态为 'running'

### 10.3 前端触发函数

```typescript
interface OpenConversationOptions {
  conversationId: string;
}

function openAgentConversation(options: OpenConversationOptions): void {
  const url = `/chat?conversationId=${options.conversationId}`;
  window.open(url, '_blank');
}
```

### 10.4 与断线重连的关系

`openAgentConversation` 创建的会话，本质上是"等待重连"的会话：

```
后端 archive API
    │
    ├─ 创建 conversation + messages
    ├─ 写入 Redis: { phase: 'waiting', agentId: 'document' }
    └─ 返回 conversationId
           │
           └─ 前端 openAgentConversation()
                  │
                  └─ 打开新标签页
                         │
                         └─ 页面加载，走 activateConversation() 流程
                                │
                                ├─ GET /api/chat/session/:id → { phase: 'waiting' }
                                │
                                ├─ 建立 SSE 连接
                                │
                                └─ 调用 resume API
                                       │
                                       └─ Agent 启动，phase → 'running'
```

**与普通重连的区别：**

| 场景       | Redis phase      | 前端行为                   |
| ---------- | ---------------- | -------------------------- |
| 普通重连   | `running`        | 建立 SSE，继续接收事件     |
| Agent 触发 | `waiting`        | 建立 SSE + 调用 resume API |
| 已结束     | `done` 或 `null` | 无需 SSE，渲染最终状态     |

**共享的核心流程：**

1. `GET /api/chat/session/:id` 查询状态
2. `activateConversation()` 判断是否需要 SSE
3. 重连/新建 SSE 连接
