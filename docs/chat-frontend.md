# Chat 前端状态机设计

## 设计原则

1. **前后端状态命名统一**：SessionFSM 使用共享的 `SessionPhase`，MessageFSM 使用共享的 `MessagePhase`，消除映射歧义。
2. **连接与会话分离**：连接状态（`isConnecting`/`isConnected`）从 Transport 层派生，不混入 FSM phase。
3. **事件重放兼容**：SSE 重连时，后端会先重放所有累积事件，最后发送 `connected`。前端必须正确处理重放期间的事件流。
4. **无静默转换**：所有状态转换触发 `onTransition` 回调，确保 SessionFSM 能同步聚合状态。
5. **事件路由精确**：通过 `messageId` 精确路由事件到对应 MessageFSM，不再使用「最后一条消息」兜底。

## 分层概念

```
┌─────────────────────────────────────────────────────────────┐
│                    SessionFSM                                │
│  会话层：聚合消息状态，管理 SSE 连接生命周期                  │
│  phase: waiting | active | canceling | error | done          │
│  连接状态: 从 Transport 派生（isConnecting / isConnected）   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Map<messageId, MessageFSM>
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MessageFSM                              │
│  消息层：管理单条消息的生命周期                               │
│  phase: initialized | streaming | awaiting_input | ...       │
│  持有：PendingMessage（累积 content/events）                 │
└─────────────────────────────────────────────────────────────┘
```

## 1. SSE 连接与事件重放

### 连接时序

```
前端调用 connect()
    │
    ▼
建立 SSE 连接 ──► 后端 bindConnection()
                    │
                    ├── 重放所有非终态 MessageFSM 的累积事件
                    │   （按 seq 顺序发送 start, stream, tool_call...）
                    │
                    └── 发送 { type: 'connected' }
    │
    ◄────────────── 收到重放事件
    │               （MessageFSM 逐个处理，状态从 initialized → streaming）
    ◄────────────── 收到 connected
    │
    ▼
SessionFSM: phase = waiting
Transport: isConnected = true
如果重放后存在非终态 MessageFSM ──► transition('active')
```

**关键保证**：收到 `connected` 时，所有历史事件已处理完毕，状态已同步。

### SessionFSM.connect()

```typescript
connect(): Promise<void> {
  if (this.isConnected) return Promise.resolve();

  // Only allow connection from initial state or after error
  if (this._phase !== null && this._phase !== 'error') {
    return Promise.resolve();
  }

  // Create a fresh sm for this connection attempt
  this.sm = new StateMachine<SessionPhase>({
    initialPhase: 'waiting',
    transitions: SESSION_PHASE_TRANSITIONS,
  });
  this._phase = 'waiting';

  this.sm.addEventListener('transition', () => {
    this._phase = this.sm.phase;
  });

  const transport = new SSEClientTransport(
    `/api/chat/sse/${this.conversationId}`,
  );

  this.transport = transport;

  transport.addEventListener('message', (e: CustomEvent<SSEMessage>) => {
    this.handleEvent(e.detail as AgentEvent);
  });

  transport.addEventListener('disconnect', () => {
    if (this.phase !== 'done' && this.phase !== 'error') {
      this.sm.transition('error');
    }
  });

  transport.addEventListener('error', () => {
    this.sm.transition('error');
  });

  return transport.connect().then(undefined, () => {
    this.sm.transition('error');
    throw new Error('SSE connection failed');
  });
}
```

## 2. 会话层状态机 SessionFSM

### 状态定义（与后端统一）

| 状态        | 是否终态 | 含义                               |
| ----------- | -------- | ---------------------------------- |
| `waiting`   | 否       | SSE 已连接（或可连接），无活跃消息 |
| `active`    | 否       | 至少有一个 MessageFSM 处于非终态   |
| `canceling` | 否       | 取消 API 请求飞行中（会话级）      |
| `error`     | 否       | 不可恢复的连接/启动错误            |
| `done`      | 是       | 会话已关闭，触发 cleanup           |

### 连接状态（从 Transport 派生）

```typescript
get isConnecting(): boolean { return this.transport?.isConnecting ?? false; }
get isConnected(): boolean { return this.transport?.isConnected ?? false; }
get canStartChat(): boolean { return this.phase === 'waiting' && this.isConnected; }
get isLoading(): boolean { return this.isConnecting || this.phase === 'active'; }
```

### 状态转换

```
waiting  ──► active        （任一 MessageFSM 进入非终态）
waiting  ──► error         （SSE 断开 / 连接错误）
waiting  ──► done          （cleanup）

active   ──► waiting       （所有 MessageFSM 到达终态）
active   ──► canceling     （调用 cancelConversation()）
active   ──► error         （SSE 断开 / 连接错误）
active   ──► done          （cleanup）

canceling ──► done         （所有 MessageFSM 到达终态后 cleanup）
canceling ──► error        （cancel API 失败）

error    ──► done          （cleanup）
```

### Phase 同步机制

SessionFSM 通过给每个 MessageFSM 绑定 `transition` 事件监听来感知消息状态变化：

```typescript
private bindMessageFSMListeners(fsm: MessageFSM): void {
  fsm.addEventListener('transition', () => {
    if (fsm.isTerminated) {
      this.onMessageTerminated();
      return;
    }

    if (fsm.isActive) {
      this.onMessageActive();
    }
  });
}

private onMessageActive(): void {
  if (this.phase === 'waiting') {
    this.sm.transition('active');
  }
}

private onMessageTerminated(): void {
  const hasActive = Array.from(this.messageFSMs.values()).some(
    fsm => fsm.isActive,
  );

  if (hasActive) return;

  if (this.phase === 'active') {
    this.sm.transition('waiting');
    return;
  }
  if (this.phase === 'canceling') {
    this.cleanup();
    return;
  }
}
```

## 3. 消息层状态机 MessageFSM

### 状态定义（与后端统一）

| 状态             | 是否终态 | 含义                                              |
| ---------------- | -------- | ------------------------------------------------- |
| `initialized`    | 否       | 消息已创建（前端临时或后端确认），等待 agent 开始 |
| `streaming`      | 否       | 正在接收流式事件                                  |
| `awaiting_input` | 否       | Agent 等待用户输入                                |
| `submitting`     | 否       | submitHumanInput API 飞行中                       |
| `canceling`      | 否       | 取消 API 飞行中（消息级）                         |
| `final`          | 是       | 正常完成                                          |
| `canceled`       | 是       | 已取消                                            |
| `error`          | 是       | 错误                                              |

### 状态转换

```
initialized ──► streaming      （收到 start/stream/thought/tool_call）
initialized ──► canceling      （调用 cancel()）
initialized ──► error          （收到 error 事件）

streaming   ──► streaming      （持续接收 stream/thought/tool 事件）
streaming   ──► awaiting_input （收到 tool_progress status=awaiting_input）
streaming   ──► final          （收到 final 事件）
streaming   ──► canceled       （收到 cancelled 事件）
streaming   ──► error          （收到 error 事件）
streaming   ──► canceling      （调用 cancel()）

awaiting_input ──► submitting  （调用 submitInput()）
awaiting_input ──► streaming   （收到 tool_result）
awaiting_input ──► canceling   （调用 cancel()）
awaiting_input ──► canceled    （收到 cancelled 事件）
awaiting_input ──► error       （收到 error 事件）

submitting  ──► streaming      （收到 tool_result / 业务事件）
submitting  ──► error          （API 失败）
submitting  ──► canceled       （收到 cancelled 事件）
submitting  ──► canceling      （调用 cancel()）

canceling   ──► canceled       （收到 cancelled 事件）
canceling   ──► error          （收到 error 事件）
```

### 工厂方法

#### 新消息（startChat 创建）

```typescript
// 创建临时消息（前端乐观更新）
const fsm = new MessageFSM(tempId, tempMessage);
// phase 初始为 'initialized'
```

#### 历史消息（从 DB 加载）

```typescript
static fromMessage(msg: Message): MessageFSM {
  const events = msg.events ? [...msg.events] : [];

  const fsm = new MessageFSM(msg.id, msg);

  // 清空已有事件后重放
  if (fsm.msg.events) {
    fsm.msg.events = [];
  }

  for (const event of events) {
    fsm.handleEvent(event);
  }
  return fsm;
}
```

### 核心接口

```typescript
class MessageFSM {
  readonly messageId: string;
  readonly phase: MessagePhase;

  // 状态查询
  get isTerminated(): boolean;
  get isInitialized(): boolean;
  get isStreaming(): boolean;
  get isAwaitingInput(): boolean;
  get isActive(): boolean;
  get isCancellable(): boolean;

  // 等待用户输入数据（由 tool_progress 事件提取）
  get awaitingInput(): AwaitingInputData | null;

  // 派生数据（从 events 计算）
  get toolCallTimeline(): ToolCallTimeline[];
  get thoughts(): ThoughtItem[];
  get hasContent(): boolean;
  get hasEvents(): boolean;
  get hasPendingTools(): boolean;
  get isThinking(): boolean;
  get shouldExpandDetails(): boolean;

  // 实体访问
  get msg(): Message;

  // 事件处理（来自 SSE）
  handleEvent(event: AgentEvent): void;

  // 动作
  start(): boolean; // initialized → streaming
  submitInput(): boolean; // awaiting_input → submitting
  cancel(): void; // → canceling / canceled
  close(): void; // 强制关闭 → canceled
}
```

## 4. ChatStore 职责

```typescript
class ChatStore {
  // 会话管理
  private sessions = new Map<string, SessionFSM>();

  acquireSession(conversationId: string): SessionFSM;
  getSession(conversationId: string): SessionFSM | undefined;

  // 核心流程
  async startChat(params: StartChatRequest): Promise<void>;
  async cancelChat(params: CancelChatRequest): Promise<void>;
  async submitHumanInput(params: SubmitHumanInputRequest): Promise<void>;

  // 重连恢复
  async activateConversation(conversationId: string): Promise<void>;

  // 监听会话切换，自动 activate/deactivate
  private cleanupOldSessions(oldId: string): void;
  private initializeMessageFSMs(conversationId: string): void;
}
```

## 5. 组件使用

| 组件                     | 数据来源                                   |
| ------------------------ | ------------------------------------------ |
| `AssistantMessage.tsx`   | `MessageFSM.msg`, `MessageFSM.phase`       |
| `Chat/index.tsx`         | `SessionFSM.phase`, `SessionFSM.isLoading` |
| `UniversalEventRenderer` | `MessageFSM.toolCallTimeline`, `thoughts`  |
| `HumanInputForm`         | `MessageFSM.awaitingInput`                 |
| `CancelButton`           | `MessageFSM.isCancellable`                 |

## 6. 文件结构

```
src/shared/utils/
└── StateMachine.ts         # 泛型同步状态机 + 共享 transition map 常量

src/shared/transport/
└── Transport.ts            # Transport 抽象基类

src/client/store/modules/
├── chat.ts                 # ChatStore（会话管理、流程编排）
├── SessionFSM.ts           # 会话层状态机
├── MessageFSM.ts           # 消息层状态机
├── PendingMessage.ts       # 事件累积载体
├── transport/
│   └── SSEClientTransport.ts  # 客户端 SSE Transport 实现
└── conversation.ts         # ConversationStore（消息数据持久化）
```
