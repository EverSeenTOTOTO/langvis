# Chat 前端状态机设计

## 设计原则

1. **与后端状态命名统一**：使用 `initialized` 替代 `placeholder`/`loading`，与后端 MessagePhase 保持一致。
2. **事件重放兼容**：SSE 重连时，后端会先重放所有累积事件，最后发送 `connected`。前端必须正确处理重放期间的事件流。
3. **无静默转换**：所有状态转换触发 `onTransition` 回调，确保 SessionFSM 能同步聚合状态。
4. **事件路由精确**：通过 `messageId` 精确路由事件到对应 MessageFSM，不再使用「最后一条消息」兜底。

## 分层概念

```
┌─────────────────────────────────────────────────────────────┐
│                    SessionFSM                           │
│  会话层：管理 SSE 连接生命周期，聚合消息状态                  │
│  phase: idle | connecting | connected | active | ...         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Map<messageId, MessageFSM>
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MessageFSM                              │
│  消息层：管理单条消息的生命周期                               │
│  phase: initialized | streaming | awaiting_input | ...       │
│  持有：Message 对象引用（直接修改 content/events）           │
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
SessionFSM 检查是否有活跃 MessageFSM
    ├── 有 ──► transition('active')
    └── 无 ──► 保持 connected
```

**关键保证**：收到 `connected` 时，所有历史事件已处理完毕，状态已同步。

### SessionFSM.connect()

```typescript
connect(): Promise<void> {
  this.reset();
  this.sm.transition('connecting');

  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(url);

    // 超时处理
    const timeout = setTimeout(() => {
      eventSource.close();
      this.sm.transition('error');
      reject(new Error('SSE connection timeout'));
    }, 30_000);

    eventSource.addEventListener('message', event => {
      const msg: SSEMessage = JSON.parse(event.data);

      // 心跳保活
      if (msg.type === 'heartbeat') return;

      // 业务事件：路由到对应 MessageFSM
      if (isAgentEvent(msg)) {
        this.handleEvent(msg);
        return;
      }

      // 控制事件
      switch (msg.type) {
        case 'connected': {
          clearTimeout(timeout);
          this.sm.transition('connected');

          // 检查是否有非终态 MessageFSM（如 awaiting_input）
          const hasActive = Array.from(this.messageFSMs.values())
            .some(fsm => !fsm.isTerminated);

          if (hasActive) {
            this.sm.transition('active');
          }
          resolve();
          break;
        }

        case 'session_replaced':
          this.sm.transition('idle');
          this.closeEventSource();
          break;

        case 'session_error':
          this.sm.transition('error');
          this.options.onError(this.conversationId, msg.error);
          reject(new Error(msg.error));
          break;
      }
    });

    eventSource.addEventListener('error', () => {
      clearTimeout(timeout);
      // 区分连接期错误 vs 运行期断开
      if (this.phase === 'connecting') {
        this.sm.transition('error');
        reject(new Error('SSE connection failed'));
      } else if (this.phase === 'connected' || this.phase === 'active') {
        // 运行期断开，可能是正常结束或网络问题
        this.options.onError(this.conversationId, 'SSE connection lost');
      }
    });
  });
}
```

## 2. 会话层状态机 SessionFSM

### 状态定义

| 状态         | 是否终态 | 含义                                         |
| ------------ | -------- | -------------------------------------------- |
| `idle`       | 否       | 无 SSE 连接，可以发起新 chat                 |
| `connecting` | 否       | SSE 连接建立中（新建或重连共用）             |
| `connected`  | 否       | SSE 已连接，无活跃消息                       |
| `active`     | 否       | SSE 已连接，至少有一个 MessageFSM 处于非终态 |
| `canceling`  | 否       | 取消 API 请求飞行中（会话级）                |
| `error`      | 否       | 不可恢复的连接/启动错误                      |
| `canceled`   | 否       | 已取消（主动取消或切换会话静默取消）         |

### 状态转换

```
idle ──► connecting      （调用 connect()）

connecting ──► connected  （收到 connected 事件，且无活跃消息）
connecting ──► active     （收到 connected 事件，且有活跃消息）
connecting ──► error      （超时 / SSE error）
connecting ──► canceled   （调用 deactivate()）

connected ──► active      （任一 MessageFSM 进入 streaming/awaiting_input）
connected ──► idle        （收到 session_ended / 正常关闭）
connected ──► error       （SSE error）
connected ──► canceled    （调用 deactivate()）

active ──► active         （收到消息事件，持续 streaming）
active ──► connected      （所有 MessageFSM 到达终态）
active ──► canceling      （调用 cancelConversation()）
active ──► error          （SSE error）
active ──► canceled       （调用 deactivate()）

canceling ──► canceled    （cancel API 成功）
canceling ──► error       （cancel API 失败）

error ──► canceled        （调用 deactivate()）

canceled ──► connecting   （重新激活）
```

### Phase 同步机制

SessionFSM 通过给每个 MessageFSM 传入 `onTransition` 回调来感知消息状态变化：

```typescript
private createMessageOnTransition() {
  return (from: MessagePhase, to: MessagePhase) => {
    // 消息进入活跃状态
    if (to === 'streaming' || to === 'awaiting_input') {
      if (this.phase === 'connected') {
        this.sm.transition('active');
      }
    }

    // 消息到达终态
    if (['final', 'canceled', 'error'].includes(to)) {
      this.onMessageTerminal();
    }

    // 清理 awaitingInputData
    if (from === 'awaiting_input') {
      // _awaitingInputData 在 MessageFSM 内部清理
    }
  };
}

private onMessageTerminal(): void {
  const hasActive = Array.from(this.messageFSMs.values())
    .some(fsm => !fsm.isTerminated);

  if (!hasActive && this.phase === 'active') {
    this.sm.transition('connected');
  } else if (!hasActive && this.phase === 'canceling') {
    this.sm.transition('canceled');
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

submitting  ──► streaming      （收到 tool_result / 业务事件）
submitting  ──► error          （API 失败）
submitting  ──► canceled       （收到 cancelled 事件）

canceling   ──► canceled       （收到 cancelled 事件）
canceling   ──► error          （收到 error 事件）
```

### 工厂方法

#### 新消息（startChat 创建）

```typescript
// 创建临时消息（前端乐观更新）
const fsm = new MessageFSM(tempId, tempMessage);
fsm.sm.transition('initialized'); // 显式转换，触发回调
```

#### 历史消息（从 DB 加载）

```typescript
static fromMessage(msg: Message, options?: MessageFSMOptions): MessageFSM {
  const fsm = new MessageFSM(msg.id, msg, options);
  const events = msg.meta?.events ?? [];

  // 重放历史事件，正常触发 transition（非静默）
  // 这样 SessionFSM 能感知到 awaiting_input 等状态
  for (const event of events) {
    fsm.handleEvent(event);
  }

  return fsm;
}
```

**注意**：与旧设计不同，不再使用 `silentTransition`。重放历史事件时正常触发 `onTransition`，确保 SessionFSM 正确聚合状态。

### 核心接口

```typescript
class MessageFSM {
  readonly messageId: string;
  readonly phase: MessagePhase;
  readonly content: string;
  readonly events: AgentEvent[];

  // 状态查询
  get isTerminated(): boolean;
  get isStreaming(): boolean;
  get isAwaitingInput(): boolean;
  get isCancellable(): boolean;

  // 等待用户输入数据（由 tool_progress 事件提取）
  get awaitingInput(): AwaitingInputData | null;

  // 派生数据（从 events 计算）
  get toolCallTimeline(): ToolCallTimeline[];
  get thoughts(): ThoughtItem[];

  // 事件处理（来自 SSE）
  handleEvent(event: AgentEvent): void;

  // 动作
  start(): boolean; // initialized → streaming（实际是收到首事件时转换）
  submitInput(): boolean; // awaiting_input → submitting
  cancel(): void; // → canceling / canceled
  close(): void; // 强制关闭 → canceled
}
```

### handleEvent 实现

```typescript
handleEvent(event: AgentEvent): void {
  if (this.isTerminated) return;

  // 1. 应用事件到数据
  this.applyEvent(event);

  // 2. 根据事件类型转换状态
  const target = this.resolveTargetPhase(event);
  if (target) {
    this.sm.transition(target);
  }
}

private applyEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'stream':
      this._message.content += event.content;
      break;

    case 'thought':
    case 'tool_call':
    case 'tool_result':
    case 'tool_error':
    case 'cancelled':
    case 'error':
      this.appendEvent(event);
      break;

    case 'tool_progress':
      this.appendEvent(event);
      this.handleAwaitingInput(event);
      break;

    case 'final':
      this.appendEvent(event);
      break;
  }
}

private resolveTargetPhase(event: AgentEvent): MessagePhase | null {
  switch (event.type) {
    case 'start':
    case 'stream':
    case 'thought':
    case 'tool_call':
      if (this.phase === 'initialized') return 'streaming';
      return null;

    case 'tool_progress': {
      const data = event.data as { status?: string } | undefined;
      if (data?.status === 'awaiting_input') return 'awaiting_input';
      if (this.phase === 'initialized') return 'streaming';
      return null;
    }

    case 'tool_result':
    case 'tool_error':
      if (this.phase === 'awaiting_input') return 'streaming';
      if (this.phase === 'submitting') return 'streaming';
      return null;

    case 'final':
      return 'final';

    case 'cancelled':
      return 'canceled';

    case 'error':
      return 'error';

    default:
      return null;
  }
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

### startChat 流程

```typescript
async startChat(params) {
  const conversationId = this.conversationStore.currentConversationId;
  const session = this.acquireSession(conversationId);

  // 1. 创建乐观消息
  const tempAssistantId = generateId('msg');
  this.addPendingMessages(conversationId, params.content, tempAssistantId);

  // 2. 创建 MessageFSM
  const messages = this.conversationStore.messages[conversationId];
  const assistantMessage = messages[messages.length - 1];
  session.addMessageFSM(tempAssistantId, assistantMessage);

  // 3. 建立 SSE
  await session.connect();

  // 4. 调用 API 启动后端 agent
  const res = await this.apiStartChat(params);

  // 5. 替换临时 ID
  if (res.messageId) {
    this.replaceMessageId(conversationId, tempAssistantId, res.messageId);
    session.removeMessageFSM(tempAssistantId);
    const updatedMessage = /* 获取更新后的消息 */;
    session.addMessageFSM(res.messageId, updatedMessage);
  }
}
```

### activateConversation 流程（重连）

```typescript
async activateConversation(conversationId: string): Promise<void> {
  // 1. 查询后端状态
  const state = await this.getSessionState({ conversationId });
  if (!state || state.phase === 'done') return;

  // 2. 获取会话，初始化所有消息的 FSM
  const session = this.acquireSession(conversationId);
  this.initializeMessageFSMs(conversationId);  // 从 DB 加载，fromMessage 重放历史事件

  // 3. 建立 SSE，后端会重放运行时事件
  try {
    await session.connect();
  } catch {
    // 连接失败，刷新消息列表
    await this.conversationStore.getMessagesByConversationId({ id: conversationId });
  }
}
```

## 5. 组件使用

| 组件                     | 数据来源                                  |
| ------------------------ | ----------------------------------------- |
| `AssistantMessage.tsx`   | `MessageFSM.content`, `MessageFSM.phase`  |
| `Chat/index.tsx`         | `SessionFSM.phase`                        |
| `UniversalEventRenderer` | `MessageFSM.toolCallTimeline`, `thoughts` |
| `HumanInputForm`         | `MessageFSM.awaitingInput`                |
| `CancelButton`           | `MessageFSM.isCancellable`                |

## 6. 文件结构

```
src/client/store/modules/
├── chat.ts                 # ChatStore（会话管理、流程编排）
├── SessionFSM.ts      # 会话层状态机
├── MessageFSM.ts           # 消息层状态机
└── conversation.ts         # ConversationStore（消息数据持久化）

src/shared/utils/
└── StateMachine.ts         # 泛型同步状态机（前后端共用）
```
