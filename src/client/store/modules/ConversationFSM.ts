import { AgentEvent, ConversationPhase, SSEMessage } from '@/shared/types';
import type { Conversation, Message } from '@/shared/types/entities';
import type { MessagePhase } from '@/shared/types';
import { isClient } from '@/shared/utils';
import { StateMachine } from '@/shared/utils/StateMachine';
import { makeAutoObservable } from 'mobx';
import { getPrefetchPath } from '../../decorator/api';
import { MessageFSM } from './MessageFSM';

const VALID_TRANSITIONS: Record<ConversationPhase, ConversationPhase[]> = {
  idle: ['connecting'],
  connecting: ['connected', 'error', 'canceled'],
  connected: ['active', 'idle', 'error', 'canceled'],
  active: ['connected', 'canceling', 'error', 'canceled'],
  canceling: ['canceled', 'error'],
  error: ['canceled'],
  canceled: ['connecting'],
};

const TERMINAL_MESSAGE_PHASES: MessagePhase[] = ['final', 'canceled', 'error'];

export interface ConversationFSMOptions {
  onEvent: (conversationId: string, event: AgentEvent) => void;
  onError: (conversationId: string, error: string) => void;
  onRefreshMessages: (conversationId: string) => void;
}

export class ConversationFSM {
  readonly conversationId: string;

  private _conversation: Conversation | null = null;
  private eventSource: EventSource | null = null;
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

    makeAutoObservable<this, 'eventSource' | 'options' | 'messageFSMs' | 'sm'>(
      this,
      {
        eventSource: false,
        options: false,
        messageFSMs: false,
        sm: false,
      },
    );
  }

  // === Conversation properties (read-only access) ===

  get name(): string {
    return this._conversation?.name ?? '';
  }

  get config(): Record<string, unknown> | null {
    return this._conversation?.config ?? null;
  }

  get groupId(): string | undefined {
    return this._conversation?.groupId;
  }

  get order(): number {
    return this._conversation?.order ?? 0;
  }

  get createdAt(): Date | undefined {
    return this._conversation?.createdAt;
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

  getOrCreateMessageFSM(message: Message): MessageFSM {
    let fsm = this.messageFSMs.get(message.id);
    if (!fsm) {
      fsm = MessageFSM.fromMessage(message, {
        onTransition: this.createMessageOnTransition(),
      });
      this.messageFSMs.set(message.id, fsm);
    }
    return fsm;
  }

  addMessageFSM(msgId: string, message: Message): MessageFSM {
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
    return (_from: MessagePhase, to: MessagePhase) => {
      if (TERMINAL_MESSAGE_PHASES.includes(to)) {
        this.onMessageTerminal();
      } else if (to === 'loading' || to === 'streaming') {
        this.onMessageActive();
      }
    };
  }

  private onMessageActive(): void {
    if (this.phase === 'connected') {
      this.sm.transition('active');
    }
  }

  private onMessageTerminal(): void {
    const hasActive = Array.from(this.messageFSMs.values()).some(
      fsm => !fsm.isTerminated,
    );

    if (!hasActive && this.phase === 'active') {
      this.sm.transition('connected');
    } else if (!hasActive && this.phase === 'canceling') {
      this.sm.transition('canceled');
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

    return new Promise((resolve, reject) => {
      const path = `/api/chat/sse/${this.conversationId}`;
      const url =
        path.startsWith('/') && !isClient() ? getPrefetchPath(path) : path;

      const eventSource = new EventSource(url, {
        withCredentials: true,
      });

      this.eventSource = eventSource;

      const timeout = setTimeout(() => {
        eventSource.close();
        this.eventSource = null;
        this.sm.transition('error');
        reject(new Error('SSE connection timeout'));
      }, 30_000);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        this.eventSource = null;
        if (this.phase === 'connecting') {
          this.sm.transition('error');
          reject(new Error('SSE connection failed'));
        } else if (this.phase === 'connected') {
          // SSE connection closed normally after stream ended - this is expected
        } else {
          this.sm.transition('error');
          this.options.onError(this.conversationId, 'SSE connection lost');
        }
      });

      eventSource.addEventListener('message', event => {
        clearTimeout(timeout);

        try {
          const msg: SSEMessage = JSON.parse(event.data);

          if (msg.type === 'connected') {
            this.sm.transition('connected');
            // Check if any MessageFSM is still active (e.g., awaiting_input)
            // Exclude placeholder messages that never started
            const hasActive = Array.from(this.messageFSMs.values()).some(
              fsm => !fsm.isTerminated && !fsm.isPlaceholder,
            );
            if (hasActive) {
              this.sm.transition('active');
            }
            resolve();
            return;
          }

          if (msg.type === 'heartbeat') {
            return;
          }

          if (msg.type === 'session_error') {
            this.sm.transition('error');
            eventSource.close();
            this.eventSource = null;
            this.options.onError(this.conversationId, msg.error);
            reject(new Error(msg.error));
            return;
          }

          if (msg.type === 'session_replaced') {
            this.sm.transition('idle');
            this.closeEventSource();
            return;
          }

          // Business event
          this.handleEvent(msg as AgentEvent);
        } catch (e) {
          this.options.onError(
            this.conversationId,
            `Failed parsing SSE message: ${(e as Error).message}`,
          );
        }
      });
    });
  }

  deactivate(): void {
    switch (this.phase) {
      case 'idle':
        this.closeEventSource();
        break;

      case 'connecting':
      case 'connected':
      case 'active':
      case 'canceling':
        this.sm.transition('canceled');
        this.closeEventSource();
        for (const fsm of this.messageFSMs.values()) {
          fsm.close();
        }
        break;

      case 'error':
      case 'canceled':
        this.closeEventSource();
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
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  // === Private methods ===

  private handleEvent(event: AgentEvent): void {
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

  private closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private reset(): void {
    this.closeEventSource();
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
