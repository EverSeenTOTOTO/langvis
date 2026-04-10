import { AgentEvent, MessagePhase } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { StateMachine } from '@/shared/utils/StateMachine';
import { ExecutionContext } from './ExecutionContext';
import logger from '../utils/logger';
import type { PendingMessage } from './PendingMessage';

const VALID_TRANSITIONS: Record<MessagePhase, MessagePhase[]> = {
  initialized: ['streaming', 'canceling', 'error'],
  streaming: [
    'streaming',
    'awaiting_input',
    'final',
    'canceled',
    'error',
    'canceling',
  ],
  // submitting: user submits input; streaming: tool_result received
  awaiting_input: ['submitting', 'streaming', 'canceling', 'canceled', 'error'],
  submitting: ['streaming', 'error', 'canceled', 'canceling'],
  canceling: ['canceled', 'error'],
  final: [],
  canceled: [],
  error: [],
};

export interface MessageFSMOptions {
  onTransition?: (
    messageId: string,
    from: MessagePhase,
    to: MessagePhase,
  ) => void;
  onPersist?: (message: Message) => Promise<unknown>;
}

export class MessageFSM {
  readonly messageId: string;
  private readonly pendingMessage: PendingMessage;
  private readonly onPersist?: MessageFSMOptions['onPersist'];
  readonly executionContext: ExecutionContext;
  private sm: StateMachine<MessagePhase>;

  constructor(
    messageId: string,
    pendingMessage: PendingMessage,
    options?: MessageFSMOptions,
  ) {
    this.messageId = messageId;
    this.pendingMessage = pendingMessage;
    this.onPersist = options?.onPersist;
    this.executionContext = new ExecutionContext(
      new AbortController(),
      messageId,
    );

    this.sm = new StateMachine({
      initialPhase: 'initialized',
      transitions: VALID_TRANSITIONS,
      onTransition: (from, to) => {
        logger.info(`Message phase changed: ${from} -> ${to}`, {
          messageId,
        });
        options?.onTransition?.(messageId, from, to);
      },
    });
  }

  get ctx(): ExecutionContext {
    return this.executionContext;
  }

  get phase(): MessagePhase {
    return this.sm.phase;
  }

  get isTerminated(): boolean {
    return ['final', 'canceled', 'error'].includes(this.phase);
  }

  get isActive(): boolean {
    return ['streaming', 'awaiting_input', 'submitting', 'canceling'].includes(
      this.phase,
    );
  }

  get isStreaming(): boolean {
    return this.phase === 'streaming';
  }

  get isAwaitingInput(): boolean {
    return this.phase === 'awaiting_input';
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

  get message(): Message {
    return this.pendingMessage.toMessage();
  }

  getReplayEvents(): AgentEvent[] {
    return this.pendingMessage.events;
  }

  handleEvent(event: AgentEvent): void {
    if (this.isTerminated) return;

    this.pendingMessage.handleEvent(event);

    switch (event.type) {
      case 'start':
      case 'stream':
      case 'thought':
      case 'tool_call':
        if (this.phase === 'initialized' || this.phase === 'submitting') {
          this.sm.transition('streaming');
        }
        break;

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

  cancel(): void {
    if (this.isCanceling || this.isTerminated) return;

    this.executionContext.abort('Cancelled by user');

    if (!this.sm.transition('canceling')) {
      this.sm.transition('canceled');
    }
  }

  async persist(): Promise<void> {
    if (this.onPersist) {
      await this.onPersist(this.pendingMessage.toMessage());
    }
  }
}
