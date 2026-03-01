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
│           │ EventSource          │ phase (only)                             │
│           │                      │                                          │
│           └──────────────────────┴────────────────────────────────────────  │
│                                │                                            │
│                                ▼                                            │
│                      ┌─────────────────────┐                               │
│                      │ ConversationStore   │                               │
│                      │ messages[conversationId]                            │
│                      │ (唯一数据源，MobX 观测) │                               │
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
│  │ (HTTP routes)   │    │ (session registry)│    │ (autonomous work unit)│  │
│  └─────────────────┘    └──────────────────┘    └───────────┬───────────┘  │
│                                                              │              │
│                                                              │ run()        │
│                                                              ▼              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│  │    Agent        │───►│ ExecutionContext │    │       Tool            │  │
│  │ (LLM orchestration)   │ (event factory)  │    │ (capabilities)        │  │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 后端架构

### 2.1 ChatSession - 自治工作单元

`ChatSession` 是单次会话运行时的完整封装，**同时拥有状态和行为**。它管理 SSE 连接、phase 状态机，并通过 `run()` 方法驱动 Agent 执行循环。

**设计原则：** 状态内聚的同时行为也内聚——持有 SSE 连接、ExecutionContext、取消信号的类，也应该是驱动 Agent 循环、处理异常和发送事件的类。ChatService 仅负责 session 的注册与销毁（registry），不介入执行细节。

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

| 职责     | 方法                                   | 说明                            |
| -------- | -------------------------------------- | ------------------------------- |
| 执行编排 | `run()`                                | 驱动 Agent 循环，处理异常和取消 |
| 状态转换 | `transition()`                         | 校验合法转换，同步关联状态      |
| 取消信号 | `cancel()`                             | 代理到 `ctx.abort()`            |
| 断线处理 | `handleDisconnect()`                   | 按 phase 分路径处理             |
| 事件发送 | `sendEvent()` / `sendControlMessage()` | 写入 SSE 连接                   |
| 资源清理 | `cleanup()`                            | 关闭连接、清理定时器            |

**关键文件：** `src/server/core/ChatSession.ts`

### 2.2 ChatService - 会话注册表

管理所有活跃 session 的注册与销毁，提供原子占位操作。不介入 Agent 执行细节。

**核心方法：**

| 方法                             | 说明                       |
| -------------------------------- | -------------------------- |
| `acquireSession(conversationId)` | 原子占位，防止 TOCTOU 竞态 |
| `getSession(conversationId)`     | 获取现有 session           |
| `runSession(session, ...)`       | 委托 `session.run()` 执行  |

**生命周期：**

```
acquireSession() → session(phase=waiting)
       ↓
bindConnection(sseConnection)
       ↓
runSession() → session.run(agent, memory, message) → phase=running
       ↓
session.run() internally: for await → sendEvent → cleanup → phase=done
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

### 4.3 callId 关联机制

`callId` 用于关联 `tool_call` 与后续事件：

```
tool_call(callId='tc_abc')
    │
    ├── tool_progress(callId='tc_abc')  // 可多次
    │
    └── tool_result(callId='tc_abc') / tool_error(callId='tc_abc')  // 终态
```

**栈式 callId 管理：**

`ExecutionContext` 内部通过 `callIdStack: string[]` 管理 callId 的生命周期，支持嵌套调用：

| 操作                           | 触发方            | 栈行为                                  |
| ------------------------------ | ----------------- | --------------------------------------- |
| `agentToolCallEvent()`         | Agent 显式调用    | **push** 新 callId                      |
| `agentToolResultEvent()`       | Agent 显式闭合    | 使用栈顶 callId，然后 **pop**           |
| `agentToolErrorEvent()`        | Agent 显式闭合    | 使用栈顶 callId，然后 **pop**           |
| `adaptToolEvent(result/error)` | Tool 事件透传闭合 | 透传 event 自带的 callId，然后 **pop**  |
| `ensureCallId()`               | ToolEvent helpers | 栈空时 **push** 新 callId，否则复用栈顶 |

**嵌套示例（A 调用中嵌套 B）：**

```
agentToolCallEvent('A')      → stack: [tc_A]
  agentToolCallEvent('B')    → stack: [tc_A, tc_B]
  agentToolResultEvent('B')  → stack: [tc_A]        // pop tc_B
agentToolResultEvent('A')    → stack: []             // pop tc_A
```

**ReAct Agent 中的实际链路：**

```
ensureCallId()               → stack: [tc_llm]       // LLM call（隐式）
agentToolCallEvent('dt')     → stack: [tc_llm, tc_dt] // date_time（显式）
adaptToolEvent(result)       → stack: [tc_llm]        // date_time 完成，pop tc_dt
ensureCallId()               → stack: [tc_llm]        // 下次 LLM call 复用
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

### 7.1 为什么 ChatSession 同时拥有状态和行为？

早期设计中，SSE 连接、phase 等状态散落在 ChatService、SSEService 等多处，难以追踪单个 session 的全貌。第一次改造将状态内聚到 ChatSession，但执行循环（`startAgent`）仍留在 ChatService，导致 ChatSession 成为"持有状态却不拥有行为"的贫血容器，API 语态分裂（`cancel` 是主动动词，`onClientDisconnect` 是被动回调）。

当前设计将执行循环（`run()`）也移入 ChatSession，使其成为自治工作单元：**谁持有状态，谁就驱动行为**。ChatService 退化为纯 registry（Map 增删 + 依赖构建），不介入执行细节。

### 7.1.1 ChatSession vs ExecutionContext 的分离

| 维度     | ChatSession                                 | ExecutionContext             |
| -------- | ------------------------------------------- | ---------------------------- |
| 生命周期 | SSE 建连时创建                              | `run()` 内部创建             |
| 暴露面   | 仅 ChatService/Controller                   | 传递给所有 Agent/Tool        |
| 关注点   | 传输层 + 执行编排（SSE、phase、Agent 循环） | 数据层（消息构建、事件工厂） |
| 持久化   | 不持久化                                    | 事件持久化到 message.meta    |

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
