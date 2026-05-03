import { AgentEvent, SSEMessage } from '@/shared/types';
import type { Conversation, Message } from '@/shared/types/entities';
import { StateMachine } from '@/shared/utils/StateMachine';
import { makeAutoObservable } from 'mobx';
import { MessageFSM } from './MessageFSM';
import { SSEClientTransport } from './transport';

export type ClientSessionPhase =
  | 'connecting'
  | 'connected'
  | 'active'
  | 'canceling'
  | 'error'
  | 'done';

const VALID_TRANSITIONS: Record<ClientSessionPhase, ClientSessionPhase[]> = {
  connecting: ['connected', 'error', 'done'],
  connected: ['active', 'error', 'done'],
  active: ['connected', 'canceling', 'error', 'done'],
  canceling: ['connected', 'done', 'error'],
  error: ['connecting', 'done'],
  done: [],
};

export interface SessionFSMEventMap {
  transition: CustomEvent<{
    from: ClientSessionPhase;
    to: ClientSessionPhase;
  }>;
  dispose: Event;
  message: CustomEvent<AgentEvent>;
}

export class SessionFSM {
  readonly conversationId: string;

  private _conversation: Conversation | null = null;
  private transport: SSEClientTransport | null = null;
  private messageFSMs = new Map<string, MessageFSM>();
  private _phase: ClientSessionPhase | null = null;
  private sm: StateMachine<ClientSessionPhase>;

  constructor(conversationId: string) {
    this.conversationId = conversationId;

    this.sm = new StateMachine<ClientSessionPhase>({
      initialPhase: 'connecting',
      transitions: VALID_TRANSITIONS,
    });

    makeAutoObservable<this, 'transport' | 'messageFSMs' | 'sm'>(this, {
      transport: false,
      messageFSMs: false,
      sm: false,
    });
  }

  addEventListener<K extends keyof SessionFSMEventMap>(
    type: K,
    listener: (ev: SessionFSMEventMap[K]) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
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

  // === Entity access ===

  get conv(): Conversation | null {
    return this._conversation;
  }

  // === Lifecycle state ===

  get phase(): ClientSessionPhase | null {
    return this._phase;
  }

  get isLoading(): boolean {
    return this._phase === 'connecting' || this._phase === 'active';
  }

  get canStartChat(): boolean {
    return this._phase === 'connected';
  }

  get isConnecting(): boolean {
    return this._phase === 'connecting';
  }

  get isConnected(): boolean {
    return this._phase === 'connected' || this._phase === 'active';
  }

  // === Conversation management ===

  setConversation(conversation: Conversation): void {
    this._conversation = conversation;
  }

  // === Message FSM management ===

  createMessageFSM(msgId: string, message: Message): MessageFSM {
    let fsm = this.messageFSMs.get(msgId);
    if (!fsm) {
      fsm = new MessageFSM(msgId, message);
      this.bindMessageFSMListeners(fsm);
      this.messageFSMs.set(msgId, fsm);
    } else {
      fsm.setMessage(message);
    }
    return fsm;
  }

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
      this.cleanup();
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
    if (this.isConnected) return Promise.resolve();

    // Reset sm for fresh connection (only if not already in a valid state)
    if (this._phase !== null && this._phase !== 'error') {
      return Promise.resolve();
    }

    // Create a fresh sm for this connection attempt
    this.sm = new StateMachine<ClientSessionPhase>({
      initialPhase: 'connecting',
      transitions: VALID_TRANSITIONS,
    });
    this._phase = 'connecting';

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

    return transport.connect().then(
      () => {
        this.sm.transition('connected');
      },
      () => {
        this.sm.transition('error');
        throw new Error('SSE connection failed');
      },
    );
  }

  deactivate(): void {
    for (const fsm of this.messageFSMs.values()) {
      fsm.close();
    }
    this.cleanup();
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
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('404'))) {
        this.sm.transition('error');
        throw e;
      }
    }
  }

  // === Private methods ===

  private handleEvent(event: AgentEvent): void {
    if (event.type === 'context_usage') {
      this.sm.dispatchEvent(new CustomEvent('message', { detail: event }));
      return;
    }

    const messageFSM = this.messageFSMs.get(event.messageId);
    if (messageFSM) {
      messageFSM.handleEvent(event);
    } else {
      console.warn(`[SessionFSM] MessageFSM not found for ${event.messageId}`);
    }

    this.sm.dispatchEvent(new CustomEvent('message', { detail: event }));
  }

  private cleanup(): void {
    this.closeTransport();
    if (this._phase !== null) {
      this.sm.transition('done');
    }
    this._phase = null;
    this.messageFSMs.clear();
    this.sm.dispatchEvent(
      new CustomEvent('dispose', { detail: this.conversationId }),
    );
  }

  private closeTransport(): void {
    this.transport?.close();
    this.transport = null;
  }
}
