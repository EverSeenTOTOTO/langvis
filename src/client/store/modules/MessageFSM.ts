import { AgentEvent, MessagePhase } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { makeAutoObservable } from 'mobx';

const VALID_TRANSITIONS: Record<MessagePhase, MessagePhase[]> = {
  placeholder: ['loading', 'error'],
  loading: ['streaming', 'canceling', 'error'],
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
  onPhaseChange?: (msgId: string, phase: MessagePhase) => void;
}

export class MessageFSM {
  readonly messageId: string;

  phase: MessagePhase;
  private message: Message;
  private options?: MessageFSMOptions;

  // Awaiting input state
  awaitingInputSchema: Record<string, unknown> | null = null;

  constructor(
    messageId: string,
    message: Message,
    options?: MessageFSMOptions,
  ) {
    this.messageId = messageId;
    this.message = message;
    this.phase = 'placeholder';
    this.options = options;
    makeAutoObservable<this, 'messageId' | 'options'>(this, {
      messageId: false,
      options: false,
    });
  }

  get isTerminal(): boolean {
    return TERMINAL_PHASES.includes(this.phase);
  }

  get isInProgress(): boolean {
    return !this.isTerminal;
  }

  get canCancel(): boolean {
    return ['loading', 'streaming', 'awaiting_input'].includes(this.phase);
  }

  get canSubmitInput(): boolean {
    return this.phase === 'awaiting_input';
  }

  get isSubmitting(): boolean {
    return this.phase === 'submitting';
  }

  handleEvent(event: AgentEvent): void {
    if (this.isTerminal) return;

    switch (event.type) {
      case 'start':
        if (this.phase === 'placeholder' || this.phase === 'loading') {
          this.transition('streaming');
        }
        break;

      case 'stream':
        if (this.phase === 'placeholder' || this.phase === 'loading') {
          this.transition('streaming');
        }
        this.message.content += event.content;
        break;

      case 'thought':
      case 'tool_call':
      case 'tool_result':
      case 'tool_error':
        if (this.phase === 'placeholder' || this.phase === 'loading') {
          this.transition('streaming');
        }
        this.appendEvent(event);
        break;

      case 'tool_progress': {
        if (this.phase === 'placeholder' || this.phase === 'loading') {
          this.transition('streaming');
        }
        this.appendEvent(event);
        // Check for awaiting_input status
        const data = event.data as
          | { status?: string; schema?: Record<string, unknown> }
          | undefined;
        if (data?.status === 'awaiting_input' && data.schema) {
          this.awaitingInputSchema = data.schema;
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
        this.message.content = event.error;
        break;
    }
  }

  cancel(): void {
    if (this.canCancel) {
      this.transition('canceling');
    }
  }

  close(): void {
    if (!this.isTerminal) {
      this.transition('canceled');
    }
  }

  replaceMessageId(newId: string): void {
    (this as { messageId: string }).messageId = newId;
  }

  setMessage(message: Message): void {
    this.message = message;
  }

  private transition(to: MessagePhase): void {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return;

    const from = this.phase;
    this.phase = to;

    // Clear awaiting input schema when leaving awaiting_input
    if (from === 'awaiting_input' && to !== 'submitting') {
      this.awaitingInputSchema = null;
    }

    this.options?.onPhaseChange?.(this.messageId, to);
  }

  private appendEvent(event: AgentEvent): void {
    if (!this.message.meta) {
      this.message.meta = { events: [] };
    }
    this.message.meta.events = this.message.meta.events ?? [];
    this.message.meta.events.push(event);
  }
}
