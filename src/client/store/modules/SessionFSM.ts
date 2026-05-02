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

export interface SessionFSMEventMap {
  transition: CustomEvent<{
    from: ConversationPhase;
    to: ConversationPhase;
  }>;
  dispose: Event;
  message: CustomEvent<AgentEvent>;
}

export class SessionFSM {
  readonly conversationId: string;

  private _conversation: Conversation | null = null;
  private transport: SSEClientTransport | null = null;
  private messageFSMs = new Map<string, MessageFSM>();
  private _phase: ConversationPhase;
  private sm: StateMachine<ConversationPhase>;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
    this._phase = 'idle';

    this.sm = new StateMachine({
      initialPhase: 'idle',
      transitions: VALID_TRANSITIONS,
    });

    this.sm.addEventListener('transition', e => {
      this._phase = (e as CustomEvent).detail.to;
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
      fsm = MessageFSM.fromMessage(message);
      this.bindMessageFSMListeners(fsm);
      this.messageFSMs.set(message.id, fsm);
    }
    return fsm;
  }

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
      if (
        this.phase === 'connecting' ||
        this.phase === 'connected' ||
        this.phase === 'active'
      ) {
        this.sm.transition('error');
      }
    });

    transport.addEventListener('error', () => {
      this.sm.transition('error');
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
    // Route event to the corresponding MessageFSM by messageId
    const messageId = (event as any).messageId as string | undefined;
    if (messageId) {
      const messageFSM = this.messageFSMs.get(messageId);
      if (messageFSM) {
        messageFSM.handleEvent(event);
      } else {
        console.warn(`[SessionFSM] MessageFSM not found for ${messageId}`);
      }
    } else {
      const activeFsm = this.getFirstActiveFSM();
      if (activeFsm) {
        activeFsm.handleEvent(event);
      }
    }

    // Forward business event to listeners
    this.sm.dispatchEvent(new CustomEvent('message', { detail: event }));
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
    this.sm.reset();
    this._phase = 'idle';
  }
}
