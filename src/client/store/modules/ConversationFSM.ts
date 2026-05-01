import { AgentEvent, ConversationPhase, SSEMessage } from '@/shared/types';
import type { Conversation, Message } from '@/shared/types/entities';
import { StateMachine } from '@/shared/utils/StateMachine';
import { makeAutoObservable } from 'mobx';
import { MessageFSM } from './MessageFSM';
import { SSEClientTransport } from './transport';

const VALID_TRANSITIONS: Record<ConversationPhase, ConversationPhase[]> = {
  idle: ['connecting'],
  connecting: ['connected', 'error', 'canceled'],
  connected: ['active', 'idle', 'error', 'canceled'],
  active: ['connected', 'canceling', 'error', 'canceled'],
  canceling: ['canceled', 'error'],
  error: ['canceled'],
  canceled: ['connecting'],
};

export interface ConversationFSMOptions {
  onEvent: (conversationId: string, event: AgentEvent) => void;
  onError: (conversationId: string, error: string) => void;
  onRefreshMessages: (conversationId: string) => void;
  onContextUsage?: (
    conversationId: string,
    used: number,
    total: number,
  ) => void;
}

export class ConversationFSM {
  readonly conversationId: string;

  private _conversation: Conversation | null = null;
  private transport: SSEClientTransport | null = null;
  private options: ConversationFSMOptions;
  private messageFSMs = new Map<string, MessageFSM>();
  private _phase: ConversationPhase;
  private sm: StateMachine<ConversationPhase>;

  constructor(conversationId: string, options: ConversationFSMOptions) {
    this.conversationId = conversationId;
    this.options = options;
    this._phase = 'idle';

    this.sm = new StateMachine({
      initialPhase: 'idle',
      transitions: VALID_TRANSITIONS,
      onTransition: (from, to) => {
        this._phase = to;
        console.log(
          `[ConversationFSM] ${this.conversationId}: ${from} -> ${to}`,
        );
      },
    });

    makeAutoObservable<this, 'transport' | 'options' | 'messageFSMs' | 'sm'>(
      this,
      {
        transport: false,
        options: false,
        messageFSMs: false,
        sm: false,
      },
    );
  }

  // === Entity access ===

  get conv(): Conversation | null {
    return this._conversation;
  }

  // === Lifecycle state ===

  get phase(): ConversationPhase {
    return this._phase;
  }

  get hasActiveMessage(): boolean {
    return this.phase === 'active';
  }

  get canStartChat(): boolean {
    return this.phase === 'idle' || this.phase === 'connected';
  }

  get isConnecting(): boolean {
    return this.phase === 'connecting';
  }

  // === Conversation management ===

  setConversation(conversation: Conversation): void {
    this._conversation = conversation;
  }

  // === Message FSM management ===

  restoreMessageFSM(message: Message): MessageFSM {
    let fsm = this.messageFSMs.get(message.id);
    if (!fsm) {
      fsm = MessageFSM.fromMessage(message, {
        onTransition: this.createMessageOnTransition(),
      });
      this.messageFSMs.set(message.id, fsm);
    }
    return fsm;
  }

  createMessageFSM(msgId: string, message: Message): MessageFSM {
    let fsm = this.messageFSMs.get(msgId);
    if (!fsm) {
      fsm = new MessageFSM(msgId, message, {
        onTransition: this.createMessageOnTransition(),
      });
      this.messageFSMs.set(msgId, fsm);
    } else {
      fsm.setMessage(message);
    }
    return fsm;
  }

  private createMessageOnTransition() {
    return (fsm: MessageFSM) => {
      if (fsm.isTerminated) {
        this.onMessageTerminated();
        return;
      }

      if (fsm.isActive) {
        this.onMessageActive();
        return;
      }
    };
  }

  private onMessageActive(): void {
    if (this.phase === 'connected') {
      this.sm.transition('active');
    }
  }

  private onMessageTerminated(): void {
    const hasActive = Array.from(this.messageFSMs.values()).some(
      fsm => fsm.isActive,
    );

    if (hasActive) return;

    if (this.phase === 'active') {
      this.sm.transition('connected');
      return;
    }
    if (this.phase === 'canceling') {
      this.sm.transition('canceled');
      return;
    }
  }

  removeMessageFSM(msgId: string): void {
    this.messageFSMs.delete(msgId);
  }

  getMessageFSM(messageId: string): MessageFSM | undefined {
    return this.messageFSMs.get(messageId);
  }

  // === Connection management ===

  connect(): Promise<void> {
    this.reset();
    this.sm.transition('connecting');

    const transport = new SSEClientTransport(
      `/api/chat/sse/${this.conversationId}`,
    );

    this.transport = transport;

    transport.addEventListener('message', (e: CustomEvent<SSEMessage>) => {
      this.handleEvent(e.detail as AgentEvent);
    });

    transport.addEventListener('disconnect', () => {
      if (this.phase === 'connecting') {
        this.sm.transition('error');
      } else if (this.phase === 'connected' || this.phase === 'active') {
        this.sm.transition('error');
        this.options.onError(this.conversationId, 'SSE connection lost');
      }
    });

    transport.addEventListener('error', (e: CustomEvent<string>) => {
      this.sm.transition('error');
      this.options.onError(this.conversationId, e.detail);
    });

    return transport.connect().then(() => {
      this.sm.transition('connected');
      const hasActive = Array.from(this.messageFSMs.values()).some(
        fsm => fsm.isActive,
      );
      if (hasActive) {
        this.sm.transition('active');
      }
    });
  }

  deactivate(): void {
    switch (this.phase) {
      case 'idle':
        this.closeTransport();
        break;

      case 'connecting':
      case 'connected':
      case 'active':
      case 'canceling':
        this.sm.transition('canceled');
        this.closeTransport();
        for (const fsm of this.messageFSMs.values()) {
          fsm.close();
        }
        break;

      case 'error':
      case 'canceled':
        this.closeTransport();
        break;
    }
  }

  async cancelConversation(sendCancelApi: () => Promise<void>): Promise<void> {
    if (this.phase !== 'active') return;

    const cancellable = Array.from(this.messageFSMs.values()).filter(
      fsm => fsm.isCancellable,
    );

    if (cancellable.length === 0) return;

    for (const fsm of cancellable) {
      fsm.cancel();
    }
    this.sm.transition('canceling');

    try {
      await sendCancelApi();
      this.sm.transition('canceled');
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) {
        this.sm.transition('canceled');
      } else {
        this.sm.transition('error');
        throw e;
      }
    }
  }

  isConnected(): boolean {
    return this.transport?.isConnected ?? false;
  }

  // === Private methods ===

  private handleEvent(event: AgentEvent): void {
    // Handle context_usage event separately - not message-specific
    if (event.type === 'context_usage') {
      this.options.onContextUsage?.(
        this.conversationId,
        event.used,
        event.total,
      );
      return;
    }

    // Route event to the corresponding MessageFSM by messageId
    const messageId = (event as any).messageId as string | undefined;
    if (messageId) {
      const messageFSM = this.messageFSMs.get(messageId);
      if (messageFSM) {
        messageFSM.handleEvent(event);
      } else {
        console.warn(`[ConversationFSM] MessageFSM not found for ${messageId}`);
      }
    } else {
      // Fallback: dispatch to first active FSM (backward compatibility)
      const activeFsm = this.getFirstActiveFSM();
      if (activeFsm) {
        activeFsm.handleEvent(event);
      }
    }

    // Forward to ChatStore for backward compatibility
    this.options.onEvent(this.conversationId, event);

    // Handle terminal events
    if (
      event.type === 'final' ||
      event.type === 'cancelled' ||
      event.type === 'error'
    ) {
      this.options.onRefreshMessages(this.conversationId);
    }
  }

  private getFirstActiveFSM(): MessageFSM | undefined {
    for (const fsm of this.messageFSMs.values()) {
      if (!fsm.isTerminated) return fsm;
    }
    return this.messageFSMs.values().next().value;
  }

  private closeTransport(): void {
    this.transport?.close();
    this.transport = null;
  }

  private reset(): void {
    this.closeTransport();
    // Reset state machine to idle
    this._phase = 'idle';
    this.sm = new StateMachine({
      initialPhase: 'idle',
      transitions: VALID_TRANSITIONS,
      onTransition: (from, to) => {
        this._phase = to;
        console.log(
          `[ConversationFSM] ${this.conversationId}: ${from} -> ${to}`,
        );
      },
    });
  }
}
