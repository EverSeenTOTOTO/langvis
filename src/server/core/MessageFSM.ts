import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type { ExecutionContext } from './ExecutionContext';
import type { PendingMessage } from './PendingMessage';

export type MessagePhase =
  | 'initialized'
  | 'streaming'
  | 'awaiting_input'
  | 'submitting'
  | 'canceling'
  | 'final'
  | 'canceled'
  | 'error';

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
  awaiting_input: ['submitting', 'canceling', 'canceled', 'error'],
  submitting: ['streaming', 'error', 'canceled'],
  canceling: ['canceled', 'error'],
  final: [],
  canceled: [],
  error: [],
};

const TERMINAL_PHASES: MessagePhase[] = ['final', 'canceled', 'error'];

export interface MessageFSMOptions {
  onPhaseChange?: (messageId: string, phase: MessagePhase) => Promise<void>;
}

export class MessageFSM {
  readonly messageId: string;
  phase: MessagePhase;
  private pendingMessage: PendingMessage;
  private options?: MessageFSMOptions;

  constructor(
    messageId: string,
    pendingMessage: PendingMessage,
    options?: MessageFSMOptions,
  ) {
    this.messageId = messageId;
    this.pendingMessage = pendingMessage;
    this.phase = 'initialized';
    this.options = options;
  }

  get isTerminal(): boolean {
    return TERMINAL_PHASES.includes(this.phase);
  }

  get message(): Message {
    return this.pendingMessage.toMessage();
  }

  handleEvent(event: AgentEvent): void {
    if (this.isTerminal) return;

    // Accumulate content
    this.pendingMessage.handleEvent(event);

    // Update phase based on event
    switch (event.type) {
      case 'start':
      case 'stream':
      case 'thought':
      case 'tool_call':
      case 'tool_result':
      case 'tool_error':
        if (this.phase === 'initialized' || this.phase === 'submitting') {
          this.transition('streaming');
        }
        break;

      case 'tool_progress': {
        if (this.phase === 'initialized' || this.phase === 'submitting') {
          this.transition('streaming');
        }
        // Check for awaiting_input status
        const data = event.data as { status?: string } | undefined;
        if (data?.status === 'awaiting_input') {
          this.transition('awaiting_input');
        }
        break;
      }

      case 'final':
        this.transition('final');
        break;

      case 'cancelled':
        this.transition('canceled');
        break;

      case 'error':
        this.transition('error');
        break;
    }
  }

  cancel(): void {
    if (this.phase === 'canceling' || this.isTerminal) return;

    const validTargets = VALID_TRANSITIONS[this.phase];
    if (validTargets.includes('canceling')) {
      this.transition('canceling');
    } else if (validTargets.includes('canceled')) {
      this.transition('canceled');
    }
  }

  async finalize(ctx: ExecutionContext): Promise<void> {
    // If aborted, add cancelled event
    if (ctx.signal.aborted) {
      const cancelledEvent = ctx.agentCancelledEvent(
        (ctx.signal.reason as Error)?.message ?? 'Unknown',
      );
      this.pendingMessage.handleEvent(cancelledEvent);
      this.transition('canceled');
    }

    // Persist the message
    await this.persist();
  }

  async persist(): Promise<void> {
    await this.pendingMessage.persist();
  }

  private async transition(to: MessagePhase): Promise<void> {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return;

    this.phase = to;
    await this.options?.onPhaseChange?.(this.messageId, to);
  }
}
