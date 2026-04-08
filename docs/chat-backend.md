# Chat 后端状态机设计

> 日期：2026-04-06
> 状态：已批准

## 设计原则

1. **事件重放优先**：新 SSE 连接建立时，必须先重放所有非终态 MessageFSM 的累积事件，再发送 `connected` 信号。
2. **状态命名统一**：前后端使用相同的 phase 命名（`initialized` 替代 `loading`），消除映射歧义。
3. **副作用边界清晰**：状态转换只记录事实，副作用（事件发送、Redis 持久化）由显式调用方控制。
4. **无静默转换**：`silentTransition` 仅用于构造时初始化，运行期所有转换必须触发回调，确保跨层状态同步。

## 分层概念

```
┌─────────────────────────────────────────────────────────────┐
│                      SessionFSM                              │
│  会话层：管理 SSE 连接生命周期，聚合消息状态                  │
│  phase: waiting | active | canceling | error | done          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Map<messageId, MessageFSM>
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MessageFSM                              │
│  消息层：管理单条消息的生命周期                               │
│  phase: initialized | streaming | awaiting_input | ...       │
│  持有：ExecutionContext, PendingMessage（累积事件）          │
└─────────────────────────────────────────────────────────────┘
```

## 1. SSE 连接与事件重放

### SSEConnection

封装 HTTP Response，提供事件流能力。关键变更：**构造函数不自动发送 `connected`**，由外部显式控制时机。

```typescript
class SSEConnection {
  constructor(conversationId: string, response: Response);

  /**
   * 发送 handshake 信号，告知客户端事件重放已完成。
   * 必须在所有重放事件发送之后调用。
   */
  handshake(): void;

  send(event: AgentEvent): boolean;
  close(): void;
}
```

### SessionFSM.bindConnection（核心）

新连接建立时的重放逻辑：

```typescript
bindConnection(connection: SSEConnection): void {
  // 1. 关闭旧连接（如果存在）
  if (this.sseConnection) {
    this.sseConnection.send({ type: 'session_replaced' });
    this.sseConnection.close();
  }

  // 2. 重放所有非终态 MessageFSM 的累积事件（关键！）
  for (const [messageId, messageFSM] of this.messageFSMs) {
    if (!messageFSM.isTerminated) {
      const events = messageFSM.pendingMessage.events;
      for (const event of events) {
        connection.send(event);
      }
    }
  }

  // 3. 绑定新连接
  this.sseConnection = connection;

  // 4. 最后发送 connected，告知客户端"重放已完成，可以同步状态"
  connection.handshake();
}
```

**时序保证**：

- 所有累积事件（包括 `start`, `stream`, `tool_call` 等）按 seq 顺序发送
- `connected` 事件是最后一个信号，前端收到后即可信任当前状态
- 如果正在等待用户输入（`awaiting_input`），`tool_progress` 事件已包含 schema，前端可直接渲染表单

## 2. 会话层状态机 SessionFSM

### 状态定义

| 状态        | 是否终态 | 含义                               |
| ----------- | -------- | ---------------------------------- |
| `waiting`   | 否       | SSE 已连接，无活跃消息             |
| `active`    | 否       | 至少有一个 MessageFSM 处于非终态   |
| `canceling` | 否       | 收到 cancel 请求，正在 abort agent |
| `error`     | 否       | 不可恢复的错误（可重连恢复）       |
| `done`      | 是       | 正常终态，触发 cleanup             |

### 状态转换

```
waiting ──► active        （任一 MessageFSM 进入非终态）
waiting ──► done          （idle timeout / SSE disconnect，且无活跃消息）

active  ──► waiting       （所有 MessageFSM 到达终态）
active  ──► canceling     （cancelAllMessages 被调用）
active  ──► done          （SSE disconnect，但 agent 继续运行）
active  ──► error         （基础设施错误）

canceling ──► done        （所有 agent aborted successfully）
canceling ──► error       （abort failed）

error   ──► done          （cleanup）
```

### 核心接口

```typescript
class SessionFSM {
  readonly conversationId: string;
  readonly phase: SessionPhase;

  // SSE 连接管理 + 事件重放
  bindConnection(connection: SSEConnection): void;
  handleDisconnect(): Promise<void>;
  send(event: AgentEvent): boolean;

  // 消息生命周期
  addMessageFSM(messageId: string, pendingMessage: PendingMessage): MessageFSM;
  getMessageFSM(messageId: string): MessageFSM | undefined;
  cancelMessage(messageId: string): void;
  cancelAllMessages(reason: string): void;

  // 清理
  cleanup(): Promise<void>;
}
```

### onMessagePhaseChange（聚合回调）

MessageFSM 任何 phase 变化通过 `onTransition` 回调触发此方法，SessionFSM 据此更新自身 phase：

```typescript
private onMessagePhaseChange(
  messageId: string,
  from: MessagePhase,
  to: MessagePhase,
): void {
  const hasActive = Array.from(this.messageFSMs.values())
    .some(fsm => !fsm.isTerminated);

  if (hasActive && this.phase === 'waiting') {
    this.sm.transition('active');
  } else if (!hasActive && this.phase === 'active') {
    this.sm.transition('waiting');
  } else if (!hasActive && this.phase === 'canceling') {
    this.cleanup();
  }
}
```

## 3. 消息层状态机 MessageFSM

### 状态定义（与前端统一）

| 状态             | 是否终态 | 含义                        |
| ---------------- | -------- | --------------------------- |
| `initialized`    | 否       | 消息已创建，等待 agent 开始 |
| `streaming`      | 否       | 正在接收 agent 事件         |
| `awaiting_input` | 否       | Agent 等待用户输入          |
| `submitting`     | 否       | submitHumanInput API 飞行中 |
| `canceling`      | 否       | 收到 cancel 请求            |
| `final`          | 是       | 正常完成                    |
| `canceled`       | 是       | 已取消                      |
| `error`          | 是       | 错误                        |

### 状态转换

```
initialized ──► streaming      （收到 start/stream/thought/tool_call 事件）
initialized ──► canceling      （cancel() 被调用）
initialized ──► error          （agent 启动失败）

streaming   ──► streaming      （持续接收事件）
streaming   ──► awaiting_input （tool_progress status=awaiting_input）
streaming   ──► final          （收到 final 事件）
streaming   ──► canceled       （收到 cancelled 事件 / abort 信号）
streaming   ──► error          （收到 error 事件）
streaming   ──► canceling      （cancel() 被调用）

awaiting_input ──► submitting  （submitHumanInput 被调用）
awaiting_input ──► streaming   （收到 tool_result）
awaiting_input ──► canceling   （cancel() 被调用）
awaiting_input ──► canceled    （收到 cancelled 事件）

submitting  ──► streaming      （API 成功，收到 tool_result）
submitting  ──► error          （API 失败）
submitting  ──► canceled       （收到 cancelled 事件）

canceling   ──► canceled       （agent aborted 成功）
canceling   ──► error          （abort 失败）
```

### 核心接口

```typescript
class MessageFSM {
  readonly messageId: string;
  readonly phase: MessagePhase;
  readonly executionContext: ExecutionContext;
  readonly pendingMessage: PendingMessage;

  get isTerminated(): boolean;
  get isCancellable(): boolean;

  // 事件处理（状态转换 + 数据累积）
  handleEvent(event: AgentEvent): void;

  // 取消执行
  cancel(): void;

  // 持久化到 DB
  persist(): Promise<void>;
}
```

### handleEvent 实现

```typescript
handleEvent(event: AgentEvent): void {
  if (this.isTerminated) return;

  // 1. 累积事件到 PendingMessage（数据变更）
  this.pendingMessage.handleEvent(event);

  // 2. 根据事件类型转换状态（状态变更）
  switch (event.type) {
    case 'start':
    case 'stream':
    case 'thought':
    case 'tool_call':
      if (this.phase === 'initialized' || this.phase === 'submitting') {
        this.sm.transition('streaming');
      }
      break;

    case 'tool_progress': {
      if (this.phase === 'initialized' || this.phase === 'submitting') {
        this.sm.transition('streaming');
      }
      const data = event.data as { status?: string } | undefined;
      if (data?.status === 'awaiting_input') {
        this.sm.transition('awaiting_input');
      }
      break;
    }

    case 'tool_result':
    case 'tool_error':
      if (this.phase === 'awaiting_input') {
        this.sm.transition('streaming');
      }
      break;

    case 'final':
      this.sm.transition('final');
      break;

    case 'cancelled':
      this.sm.transition('canceled');
      break;

    case 'error':
      this.sm.transition('error');
      break;
  }
}
```

## 4. 两种启动模式

### 模式一：前端驱动（正常 Chat）

```
前端                           后端
 │                              │
 ├─ POST /start/:convId ───────►├─ 创建 assistant message
 │                              │
 │  (startChat 返回 messageId)  ├─ session.addMessageFSM()
 │                              │   MessageFSM: initialized
 │                              ├─ 启动 runSession()
 │                              │
 ├─ SSE /sse/:convId ──────────►├─ session.bindConnection()
 │                              │   - 无事件可重放（agent 刚开始）
 │                              │   - 发送 connected
 │                              │
 │◄──────── connected ──────────┤
 │                              │
 │◄──────── agent events ───────┤  （runSession 循环发送）
 │                              │
```

### 模式二：后端静默启动 + 前端重连（邮件归档）

```
前端                           后端
 │                              │
 │                              ├─ 静默启动（EmailController.archive）
 │                              │   - acquireSession()
 │                              │   - 创建 message
 │                              │   - addMessageFSM()
 │                              │   - runSession() → agent 开始执行
 │                              │   （事件累积到 PendingMessage，
 │                              │    但 SSE 未连接）
 │                              │
 │                              │   ... agent 持续运行，产生事件 ...
 │                              │
 ├─ 页面跳转 /sse/:convId ─────►├─ 返回已存在的 SessionFSM
 │                              ├─ session.bindConnection()
 │                              │   ⚠️ 关键：重放所有累积事件！
 │                              │   - 按 seq 发送 start, stream...
 │                              │   - 最后发送 connected
 │                              │
 │◄──────── 重放事件 ───────────┤  （前端 MessageFSM 逐个处理）
 │◄──────── connected ──────────┤  （重放完成信号）
 │                              │
 │◄──────── 新事件 ─────────────┤  （agent 继续运行）
 │                              │
```

## 5. 取消语义

### 会话级取消

```
POST /cancel/:conversationId
  └─► SessionFSM.cancelAllMessages(reason)
      ├─ 遍历所有非终态 MessageFSM，调用 cancel()
      └─ SessionFSM.transition('canceling')
         （等待所有 MessageFSM 终态后 → done）
```

### 消息级取消

```
POST /cancel/:conversationId/:messageId
  └─► SessionFSM.cancelMessage(messageId)
      └─► MessageFSM.cancel()
          ├─ executionContext.abort(reason)
          └─ sm.transition('canceling')
             （agent 检测 signal.aborted → 发送 cancelled 事件
              → handleEvent → transition('canceled')）
```

## 6. 事件格式

所有事件携带 `messageId`，用于前端精确路由：

```typescript
type AgentEvent =
  | { type: 'start'; messageId: string; seq: number; at: number }
  | {
      type: 'stream';
      messageId: string;
      content: string;
      seq: number;
      at: number;
    }
  | {
      type: 'thought';
      messageId: string;
      content: string;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_call';
      messageId: string;
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_progress';
      messageId: string;
      callId: string;
      toolName: string;
      data: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_result';
      messageId: string;
      callId: string;
      toolName: string;
      output: unknown;
      seq: number;
      at: number;
    }
  | {
      type: 'tool_error';
      messageId: string;
      callId: string;
      toolName: string;
      error: string;
      seq: number;
      at: number;
    }
  | { type: 'final'; messageId: string; seq: number; at: number }
  | {
      type: 'cancelled';
      messageId: string;
      reason: string;
      seq: number;
      at: number;
    }
  | {
      type: 'error';
      messageId: string;
      error: string;
      seq: number;
      at: number;
    };
```

## 7. Redis 持久化

### 会话状态

```typescript
interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  messages: Array<{ messageId: string; phase: MessagePhase }>;
  startedAt: number;
  agentId: string | null;
}
```

- Key: `chat_session:{conversationId}`
- TTL: 1 hour
- 更新时机：SessionFSM `onTransition` 回调中异步更新

### 僵尸检测

服务器重启后，`acquireSession` 发现 Redis 中有状态但内存中无 SessionFSM：

- `phase === 'done' | 'waiting'`：安全清理
- `phase === 'active' | 'canceling' | 'error'`：标记相关消息为 error，清理 Redis

## 8. 文件结构

```
src/shared/utils/
└── StateMachine.ts        # 泛型同步状态机

src/server/core/
├── SessionFSM.ts          # 会话层状态机
├── MessageFSM.ts          # 消息层状态机
├── PendingMessage.ts      # 事件累积载体
├── ExecutionContext.ts    # 执行上下文
├── SSEConnection.ts       # SSE 连接（延迟 handshake）
└── agent/                 # Agent 实现

src/server/service/
└── ChatService.ts         # Session 注册表、僵尸检测

src/server/controller/
└── ChatController.ts      # API 入口
```
