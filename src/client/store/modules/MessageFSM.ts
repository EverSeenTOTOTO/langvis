import { AgentEvent, MessagePhase } from '@/shared/types';
import { Role, type Message } from '@/shared/types/entities';
import { StateMachine } from '@/shared/utils/StateMachine';
import { makeAutoObservable } from 'mobx';

const DEFAULT_TRANSITIONS: Record<MessagePhase, MessagePhase[]> = {
  initialized: ['streaming', 'canceling', 'error'],
  streaming: [
    'streaming',
    'awaiting_input',
    'final',
    'canceled',
    'error',
    'canceling',
  ],
  awaiting_input: ['submitting', 'streaming', 'canceling', 'canceled', 'error'],
  submitting: ['streaming', 'error', 'canceled', 'canceling'],
  canceling: ['canceled', 'error'],
  final: [],
  canceled: [],
  error: [],
};

const TERMINATED_PHASES: MessagePhase[] = ['final', 'canceled', 'error'];

export type ToolCallTimeline = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  seq: number;
  at: number;
  status: 'pending' | 'done' | 'error';
  output?: unknown;
  error?: string;
  progress: Array<{ data: unknown; seq: number; at: number }>;
  thought?: string;
};

export type ThoughtItem = {
  content: string;
  seq: number;
  at: number;
};

export interface AwaitingInputData {
  message: string;
  schema: Record<string, unknown>;
}

export interface MessageFSMOptions {
  onTransition?: (from: MessagePhase, to: MessagePhase) => void;
}

export class MessageFSM {
  private _messageId: string;
  private _message: Message;
  private _awaitingInputData: AwaitingInputData | null = null;
  private _phase: MessagePhase;
  private sm: StateMachine<MessagePhase>;

  constructor(
    messageId: string,
    message: Message,
    options?: MessageFSMOptions,
  ) {
    this._messageId = messageId;
    this._message = message;
    this._phase = 'initialized';

    this.sm = new StateMachine({
      initialPhase: 'initialized',
      transitions: DEFAULT_TRANSITIONS,
      onTransition: (from, to) => {
        this._phase = to;
        console.log(`[MessageFSM] ${this._messageId}: ${from} -> ${to}`);
        if (from === 'awaiting_input') this._awaitingInputData = null;
        options?.onTransition?.(from, to);
      },
    });

    makeAutoObservable<this, 'sm'>(this, { sm: false });
  }

  // === Factory method for historical messages ===

  static fromMessage(msg: Message, options?: MessageFSMOptions): MessageFSM {
    // Save events before creating FSM (MobX may wrap the message object)
    const events = msg.meta?.events ? [...msg.meta.events] : [];

    const fsm = new MessageFSM(msg.id, msg, options);

    // Clear events on FSM's internal message (may be a MobX proxy)
    if (fsm._message.meta?.events) {
      fsm._message.meta.events = [];
    }

    // Replay events to restore state, triggering onTransition callbacks
    // so ConversationFSM can sync aggregate state (e.g., detect awaiting_input)
    for (const event of events) {
      fsm.handleEvent(event);
    }
    return fsm;
  }

  // === Message properties (read-only access) ===

  get messageId(): string {
    return this._messageId;
  }

  get content(): string {
    return this._message.content ?? '';
  }

  get events(): AgentEvent[] {
    return this._message.meta?.events ?? [];
  }

  get createdAt(): Date {
    return this._message.createdAt;
  }

  get role(): Role {
    return this._message.role;
  }

  get conversationId(): string {
    return this._message.conversationId;
  }

  // === Lifecycle state ===

  get phase(): MessagePhase {
    return this._phase;
  }

  get isTerminated(): boolean {
    return TERMINATED_PHASES.includes(this.phase);
  }

  get isInitialized(): boolean {
    return this.phase === 'initialized';
  }

  get isStreaming(): boolean {
    return this.phase === 'streaming';
  }

  get isAwaitingInput(): boolean {
    return this.phase === 'awaiting_input';
  }

  get awaitingInput(): AwaitingInputData | null {
    if (this.isTerminated) return null;
    return this._awaitingInputData;
  }

  get isSubmitting(): boolean {
    return this.phase === 'submitting';
  }

  get isCanceling(): boolean {
    return this.phase === 'canceling';
  }

  get isCancellable(): boolean {
    return ['streaming', 'awaiting_input'].includes(this.phase);
  }

  // === Content rendering state (derived from events) ===

  get hasContent(): boolean {
    return this.content.length > 0;
  }

  get hasEvents(): boolean {
    return this.events.length > 0;
  }

  get toolCallTimeline(): ToolCallTimeline[] {
    return this.deriveToolCallTimeline();
  }

  get pendingToolCalls(): ToolCallTimeline[] {
    return this.toolCallTimeline.filter(t => t.status === 'pending');
  }

  get hasPendingTools(): boolean {
    return this.pendingToolCalls.length > 0;
  }

  get thoughts(): ThoughtItem[] {
    return this.deriveThoughts();
  }

  get isAwaitingContent(): boolean {
    return (
      this.hasEvents &&
      !this.isTerminated &&
      !this.hasContent &&
      !this.hasPendingTools
    );
  }

  get isProcessing(): boolean {
    if (this.isTerminated || this._awaitingInputData) return false;
    if (!this.hasEvents || this.hasContent) return false;
    const tools = this.toolCallTimeline;
    return tools.length === 0 || tools.some(t => t.status === 'pending');
  }

  get shouldExpandDetails(): boolean {
    return (
      !this.isTerminated &&
      (this.toolCallTimeline.length > 0 || this.thoughts.length > 0)
    );
  }

  // === Event handling ===

  handleEvent(event: AgentEvent): void {
    if (this.isTerminated) return;

    this.applyEvent(event);

    const target = this.resolveTargetPhase(event);
    if (target) this.sm.transition(target);
  }

  // === Actions ===

  start(): boolean {
    return this.sm.transition('streaming');
  }

  cancel(): void {
    if (!this.sm.transition('canceling')) {
      this.sm.transition('canceled');
    }
  }

  close(): void {
    this.sm.transition('canceled');
  }

  submitInput(): boolean {
    return this.sm.transition('submitting');
  }

  replaceMessageId(newId: string): void {
    this._messageId = newId;
  }

  setMessage(message: Message): void {
    this._message = message;
  }

  // === Private methods ===

  private appendEvent(event: AgentEvent): void {
    if (!this._message.meta) {
      this._message.meta = { events: [event] };
    } else {
      // Create new array to trigger MobX reactivity
      this._message.meta = {
        ...this._message.meta,
        events: [...(this._message.meta.events ?? []), event],
      };
    }
  }

  private applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'start':
        this.appendEvent(event);
        break;

      case 'stream':
        this._message.content += event.content;
        break;

      case 'thought':
      case 'tool_call':
      case 'tool_result':
      case 'tool_error':
      case 'cancelled':
        this.appendEvent(event);
        break;

      case 'tool_progress':
        this.appendEvent(event);
        this.handleAwaitingInput(event);
        break;

      case 'final':
        this.appendEvent(event);
        break;
      case 'error':
        this.appendEvent(event);
        this._message.content = event.error;
        break;
    }
  }

  private handleAwaitingInput(event: AgentEvent): void {
    if (event.type !== 'tool_progress') return;

    const data = event.data as
      | {
          status?: string;
          schema?: Record<string, unknown>;
          message?: string;
          event?: AgentEvent;
        }
      | undefined;

    if (data?.status === 'agent_event' && data.event) {
      const nestedAwaiting = this.extractAwaitingInput(data.event);
      if (nestedAwaiting) {
        this._awaitingInputData = nestedAwaiting;
        return;
      }
    }

    if (data?.status === 'awaiting_input' && data.schema) {
      this._awaitingInputData = {
        message: data.message ?? 'Please provide input',
        schema: data.schema,
      };
    }
  }

  private resolveTargetPhase(event: AgentEvent): MessagePhase | null {
    const { phase } = this.sm;

    switch (event.type) {
      case 'start':
      case 'stream':
      case 'thought':
      case 'tool_call':
        if (phase === 'initialized') return 'streaming';
        return null;

      case 'tool_progress': {
        const data = event.data as
          | { status?: string; event?: AgentEvent }
          | undefined;
        if (data?.status === 'awaiting_input') return 'awaiting_input';
        if (data?.status === 'agent_event' && data.event) {
          const nestedAwaiting = this.extractAwaitingInput(data.event);
          if (nestedAwaiting) return 'awaiting_input';
        }
        if (phase === 'initialized') return 'streaming';
        return null;
      }

      case 'tool_result':
      case 'tool_error':
        if (phase === 'awaiting_input') return 'streaming';
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

  // === Derivation methods ===

  private deriveToolCallTimeline(): ToolCallTimeline[] {
    const toolCallsMap = new Map<string, ToolCallTimeline>();
    let pendingThought: string | undefined;

    for (const event of this.events) {
      switch (event.type) {
        case 'thought':
          pendingThought = event.content;
          break;

        case 'tool_call':
          toolCallsMap.set(event.callId, {
            callId: event.callId,
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            seq: event.seq,
            at: event.at,
            status: 'pending',
            progress: [],
            thought: pendingThought,
          });
          pendingThought = undefined;
          break;

        case 'tool_result': {
          const existing = toolCallsMap.get(event.callId);
          if (existing) {
            existing.status = 'done';
            existing.output = event.output;
          }
          break;
        }

        case 'tool_error': {
          const existing = toolCallsMap.get(event.callId);
          if (existing) {
            existing.status = 'error';
            existing.error = event.error;
          }
          break;
        }

        case 'tool_progress': {
          const existing = toolCallsMap.get(event.callId);
          if (existing) {
            existing.progress.push({
              data: event.data,
              seq: event.seq,
              at: event.at,
            });
          }
          break;
        }
      }
    }

    return Array.from(toolCallsMap.values()).sort((a, b) => a.seq - b.seq);
  }

  private deriveThoughts(): ThoughtItem[] {
    const thoughts: ThoughtItem[] = [];
    let pendingThought: string | undefined;

    for (const event of this.events) {
      switch (event.type) {
        case 'thought':
          pendingThought = event.content;
          break;

        case 'tool_call':
          pendingThought = undefined;
          break;

        case 'stream':
        case 'final':
          if (pendingThought) {
            thoughts.push({
              content: pendingThought,
              seq: event.seq,
              at: event.at,
            });
            pendingThought = undefined;
          }
          break;
      }
    }

    if (pendingThought) {
      const lastEvent = this.events.at(-1);
      thoughts.push({
        content: pendingThought,
        seq: lastEvent?.seq ?? 0,
        at: lastEvent?.at ?? Date.now(),
      });
    }

    return thoughts;
  }

  private extractAwaitingInput(event: AgentEvent): AwaitingInputData | null {
    if (event.type === 'tool_progress') {
      const data = event.data as
        | {
            status?: string;
            schema?: Record<string, unknown>;
            message?: string;
            event?: AgentEvent;
          }
        | undefined;

      if (data?.status === 'awaiting_input' && data.schema) {
        return {
          message: data.message ?? 'Please provide input',
          schema: data.schema,
        };
      }

      if (data?.status === 'agent_event' && data.event) {
        return this.extractAwaitingInput(data.event);
      }
    }

    return null;
  }
}
