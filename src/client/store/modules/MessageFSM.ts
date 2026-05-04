import {
  AgentEvent,
  MessagePhase,
  type ToolCallTimeline,
  buildToolTimeline,
} from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import {
  MESSAGE_PHASE_TRANSITIONS,
  StateMachine,
} from '@/shared/utils/StateMachine';
import { makeAutoObservable } from 'mobx';
import { PendingMessage } from './PendingMessage';

export type { ToolCallTimeline };

export type ThoughtItem = {
  content: string;
  seq: number;
  at: number;
};

export interface AwaitingInputData {
  message: string;
  schema: Record<string, unknown>;
}

export class MessageFSM {
  readonly messageId: string;
  private pendingMessage: PendingMessage;
  private _awaitingInputData: AwaitingInputData | null = null;
  private _phase: MessagePhase;
  private sm: StateMachine<MessagePhase>;

  constructor(messageId: string, message: Message) {
    this.messageId = messageId;
    this.pendingMessage = new PendingMessage(message);
    this._phase = 'initialized';

    this.sm = new StateMachine({
      initialPhase: 'initialized',
      transitions: MESSAGE_PHASE_TRANSITIONS,
    });

    this.sm.addEventListener('transition', e => {
      const { from } = (e as CustomEvent).detail;
      this._phase = this.sm.phase;
      if (from === 'awaiting_input') this._awaitingInputData = null;
    });

    makeAutoObservable<this, 'sm'>(this, {
      sm: false,
    });
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.sm.addEventListener(type, listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.sm.removeEventListener(type, listener);
  }

  // === Factory method for historical messages ===

  static fromMessage(msg: Message): MessageFSM {
    const events = msg.events ? [...msg.events] : [];

    const fsm = new MessageFSM(msg.id, msg);

    // Clear existing events before replay
    if (fsm.msg.events) {
      fsm.msg.events = [];
    }

    for (const event of events) {
      fsm.handleEvent(event);
    }
    return fsm;
  }

  // === Entity access ===

  get msg(): Message {
    return this.pendingMessage.toMessage();
  }

  // === Lifecycle state ===

  get phase(): MessagePhase {
    return this._phase;
  }

  get isTerminated(): boolean {
    return ['final', 'canceled', 'error'].includes(this.phase);
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

  get isActive(): boolean {
    return ['streaming', 'awaiting_input', 'submitting', 'canceling'].includes(
      this.phase,
    );
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

  // === Content rendering state (derived from pending message) ===

  get hasContent(): boolean {
    return this.pendingMessage.content.length > 0;
  }

  get hasEvents(): boolean {
    return this.pendingMessage.events.length > 0;
  }

  get toolCallTimeline(): ToolCallTimeline[] {
    return buildToolTimeline(this.pendingMessage.events);
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

  get isThinking(): boolean {
    return (
      this.hasEvents &&
      !this.isTerminated &&
      !this.hasContent &&
      !this.hasPendingTools
    );
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

    this.pendingMessage.handleEvent(event);
    this.handleAwaitingInput(event);

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
        const data = event.data as
          | { status?: string; event?: AgentEvent }
          | undefined;
        if (data?.status === 'awaiting_input') {
          this.sm.transition('awaiting_input');
        } else if (data?.status === 'agent_event' && data.event) {
          const nestedAwaiting = this.extractAwaitingInput(data.event);
          if (nestedAwaiting) {
            this.sm.transition('awaiting_input');
          }
        }
        break;
      }

      case 'tool_result':
      case 'tool_error':
        if (
          this.phase === 'initialized' ||
          this.phase === 'submitting' ||
          this.phase === 'awaiting_input'
        ) {
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

  setMessage(message: Message): void {
    this.pendingMessage = new PendingMessage(message);
  }

  // === Private methods ===

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

  private deriveThoughts(): ThoughtItem[] {
    const thoughts: ThoughtItem[] = [];
    let pendingThought: string | undefined;

    for (const event of this.pendingMessage.events) {
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
      const lastEvent = this.pendingMessage.events.at(-1);
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
