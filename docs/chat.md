# Chat 架构文档

基于 SSE (Server-Sent Events) 的流式对话系统架构。

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                        │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │   ChatStore     │───►│ ConversationState│    │ deriveMessageState()  │  │
│  │   (MobX)        │    │ (per-conversation)│    │ (render state)        │  │
│  └────────┬────────┘    └────────┬─────────┘    └───────────────────────┘  │
│           │                      │                                          │
│           │ EventSource          │ phase/buffer/streamingMessage            │
│           ▼                      ▼                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          SSE Channel (SSEMessage)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend                                         │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │ ChatController  │───►│   ChatService    │───►│    ChatSession        │  │
│  │ (HTTP routes)   │    │ (session manager)│    │ (state container)     │  │
│  └─────────────────┘    └──────────────────┘    └───────────┬───────────┘  │
│                                                              │              │
│                                                              │ ctx          │
│                                                              ▼              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │    Agent        │───►│ ExecutionContext │    │       Tool            │  │
│  │ (LLM orchestration)   │ (event factory)  │    │ (capabilities)        │  │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 后端架构

### 2.1 ChatSession - 会话状态容器

`ChatSession` 是单次会话运行时的统一状态容器，管理 SSE 连接、取消信号和 phase 状态机。

**Phase 状态机：**

```
         initSSE()
 waiting ──────────────► running
    │                        │
    │ idle timeout           │ final/error/cancel
    │ client disconnect      │ cleanup()
    ▼                        ▼
   done ◄────────────────── done
```

**核心职责：**

| 职责     | 方法                                   | 说明                       |
| -------- | -------------------------------------- | -------------------------- |
| 状态转换 | `transition()`                         | 校验合法转换，同步关联状态 |
| 取消信号 | `cancel()`                             | 代理到 `ctx.abort()`       |
| 断线处理 | `onClientDisconnect()`                 | 按 phase 分路径处理        |
| 事件发送 | `sendEvent()` / `sendControlMessage()` | 写入 SSE 连接              |
| 资源清理 | `cleanup()`                            | 关闭连接、清理定时器       |

**关键文件：** `src/server/core/ChatSession.ts`

### 2.2 ChatService - 会话管理器

管理所有活跃 session，提供原子操作。

**核心方法：**

| 方法                             | 说明                       |
| -------------------------------- | -------------------------- |
| `acquireSession(conversationId)` | 原子占位，防止 TOCTOU 竞态 |
| `getSession(conversationId)`     | 获取现有 session           |
| `startAgent(session, ...)`       | 启动 Agent 执行循环        |

**生命周期：**

```
acquireSession() → session(phase=waiting)
       ↓
bindConnection(sseConnection)
       ↓
startAgent() → session.start(ctx) → phase=running
       ↓
final/error → session.cleanup() → phase=done
       ↓
onDispose() → delete from Map, clean Redis
```

**关键文件：** `src/server/service/ChatService.ts`

### 2.3 ExecutionContext - 消息上下文

管理单条消息的构建、事件创建和持久化。

**核心职责：**

- 内容管理：`appendContent()` / `setContent()`
- 事件工厂：`agentStartEvent()` / `agentStreamEvent()` / `agentFinalEvent()` ...
- 序号生成：自动递增 `seq`，保证事件顺序
- 调用追踪：`callId` 关联 tool_call 与后续事件

**事件持久化规则：**

| 事件类型      | 持久化 | 原因               |
| ------------- | :----: | ------------------ |
| start         |   ✅   | 标记执行起点       |
| thought       |   ✅   | 推理过程有回溯价值 |
| tool_call     |   ✅   | 记录调用及参数     |
| tool_progress |   ❌   | 中间态数据量大     |
| tool_result   |   ✅   | 执行结果           |
| tool_error    |   ✅   | 失败原因           |
| stream        |   ❌   | 已累积到 content   |
| final         |   ✅   | 标记执行终点       |
| cancelled     |   ✅   | 标记取消及原因     |
| error         |   ✅   | Agent 级错误       |

**关键文件：** `src/server/core/context/index.ts`

### 2.4 ChatController - HTTP 路由

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
4. req.on('close') → session.onClientDisconnect()
```

**start 流程：**

```
1. getSession() + phase 检查
2. resolve agent, build memory
3. batchAddMessages() → 持久化消息（HTTP 响应前）
4. return 200 + messageId
5. startAgent() → 异步执行
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
| `currentStreamingMessage`  | 当前正在流式的消息   |
| `currentPhaseError`        | 当前会话的错误信息   |
| `getState(conversationId)` | 获取指定会话状态     |

**核心方法：**

| 方法                           | 说明          |
| ------------------------------ | ------------- |
| `startChat(params)`            | 启动对话      |
| `cancelChat(params)`           | 取消对话      |
| `connectToSSE(conversationId)` | 建立 SSE 连接 |

**关键文件：** `src/client/store/modules/chat.ts`

### 3.2 ConversationState - 会话状态容器

每个会话独立的 MobX 状态容器。

**状态字段：**

| 字段              | 类型                | MobX 观测 | 说明              |
| ----------------- | ------------------- | :-------: | ----------------- |
| phase             | ChatPhase           |    ✅     | 状态机阶段        |
| phaseError        | string \| null      |    ✅     | 错误信息          |
| buffer            | string              |    ✅     | Typewriter 缓冲区 |
| pendingMessageIds | string[]            |    ✅     | 乐观插入的消息 ID |
| streamingMessage  | Message \| null     |    ✅     | 当前流式消息      |
| eventSource       | EventSource \| null |    ❌     | SSE 连接句柄      |
| timer             | setInterval 句柄    |    ❌     | Typewriter 定时器 |

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
  │     finishing      error        cancelled
  │         │             │              │
  │   typewriter done     │              │
  │         │             │              │
  └─────────┴─────────────┴──────────────┘
```

**关键文件：** `src/client/store/modules/ConversationState.ts`

### 3.3 deriveMessageState - 消息渲染状态派生

从 `message.meta.events` 派生渲染状态，支持时序分析和 Agent 自定义渲染。

**派生状态：**

| 字段             | 说明                                    |
| ---------------- | --------------------------------------- |
| hasContent       | 消息是否有文本内容                      |
| hasEvents        | 是否有事件                              |
| isTerminal       | 是否已结束 (final/error/cancelled)      |
| toolCallTimeline | 按 seq 排序的工具调用时间线             |
| pendingToolCalls | 进行中的工具调用                        |
| hasPendingTools  | 是否有工具正在执行                      |
| thoughts         | 思考过程事件                            |
| rawEvents        | 原始事件数组，供特殊场景使用            |

**ToolCallTimeline 结构：**

```typescript
type ToolCallTimeline = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  seq: number;  // tool_call 的全局序列号，用于排序
  at: number;   // 时间戳
  status: 'pending' | 'done' | 'error';
  output?: unknown;
  error?: string;
  progress: Array<{ data: unknown; seq: number; at: number }>;
};
```

**渲染架构：**

```
deriveMessageState(msg) → MessageRenderState
         ↓
agentRenderers.get(agentId)(msg, state) → { content, showBubbleLoading }
         ↓
AssistantMessage 渲染 Bubble
```

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

### 4.3 callId 关联机制

`callId` 用于关联 `tool_call` 与后续事件：

```
tool_call(callId='tc_abc')
    │
    ├── tool_progress(callId='tc_abc')  // 可多次
    │
    └── tool_result(callId='tc_abc') / tool_error(callId='tc_abc')  // 终态
```

---

## 5. 关键交互流程

### 5.1 正常对话流程

```
Frontend                    Backend                     Agent
   │                           │                          │
   │──GET /sse/{id}───────────►│                          │
   │                           │──acquireSession()        │
   │◄──connected event─────────│                          │
   │                           │                          │
   │──POST /start/{id}────────►│                          │
   │                           │──batchAddMessages()      │
   │◄──200 + messageId─────────│                          │
   │                           │──startAgent()───────────►│
   │                           │                          │
   │◄──start event─────────────│◄─────yield start─────────│
   │◄──stream events───────────│◄─────yield stream────────│
   │◄──final event─────────────│◄─────yield final─────────│
   │                           │                          │
   │                           │──cleanup()               │
```

### 5.2 取消流程

```
Frontend                    Backend                     Agent
   │                           │                          │
   │──POST /cancel/{id}───────►│                          │
   │                           │──session.cancel()        │
   │                           │──ctx.abort()────────────►│
   │                           │                          │ break loop
   │◄──cancelled event─────────│◄─────finally─────────────│
   │                           │──cleanup()               │
```

### 5.3 客户端断线流程

```
Client                      Backend                     Agent
   │                           │                          │
   │──disconnect──────────────►│                          │
   │                           │──req.on('close')         │
   │                           │──session.onClientDisconnect()
   │                           │──session.cancel()────────►│
   │                           │                          │ break loop
   │                           │◄─────finally─────────────│
   │                           │──cleanup()               │
```

---

## 6. 目录结构

```
src/
├── server/
│   ├── core/
│   │   ├── ChatSession.ts        # 会话状态容器
│   │   ├── context/
│   │   │   └── index.ts          # ExecutionContext
│   │   ├── agent/                # Agent 实现
│   │   └── tool/                 # Tool 实现
│   ├── controller/
│   │   └── ChatController.ts     # HTTP 路由
│   └── service/
│       ├── ChatService.ts        # 会话管理
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

### 7.1 为什么分离 ChatSession 和 ExecutionContext？

| 维度     | ChatSession               | ExecutionContext          |
| -------- | ------------------------- | ------------------------- |
| 生命周期 | SSE 建连时创建            | Agent 启动时创建          |
| 暴露面   | 仅 ChatService/Controller | 传递给所有 Agent/Tool     |
| 关注点   | 传输层（SSE、phase）      | 数据层（消息构建）        |
| 持久化   | 不持久化                  | 事件持久化到 message.meta |

### 7.2 为什么 acquireSession 不接收 sseConnection？

`initSSEConnection()` 会立即 `writeHead(200)`，之后无法返回 409。因此必须先 acquire（可拒绝），再建连。

### 7.3 为什么按 phase 分路径取消？

| Phase      | 处理                | 原因              |
| ---------- | ------------------- | ----------------- |
| connecting | 仅前端清理          | 后端无 Agent 运行 |
| streaming  | 前端清理 + 通知后端 | Agent 正在运行    |
| finishing  | 仅前端清理          | Agent 已结束      |

### 7.4 单进程约束

`sessions` Map 是进程内存，多节点部署需引入 sticky session 或 Redis-backed registry。
