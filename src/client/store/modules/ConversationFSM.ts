import {
  AgentEvent,
  ConversationPhase,
  MessagePhase,
  SSEMessage,
} from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { isClient } from '@/shared/utils';
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

export interface ConversationFSMOptions {
  onEvent: (conversationId: string, event: AgentEvent) => void;
  onError: (conversationId: string, error: string) => void;
  onRefreshMessages: (conversationId: string) => void;
}

export class ConversationFSM {
  readonly conversationId: string;

  phase: ConversationPhase = 'idle';
  private eventSource: EventSource | null = null;
  private options: ConversationFSMOptions;
  private messageFSMs = new Map<string, MessageFSM>();

  constructor(conversationId: string, options: ConversationFSMOptions) {
    this.conversationId = conversationId;
    this.options = options;
    makeAutoObservable<this, 'eventSource' | 'options' | 'messageFSMs'>(this, {
      eventSource: false,
      options: false,
      messageFSMs: false,
    });
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

  connect(): Promise<void> {
    this.reset();
    this.transition('connecting');

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
        this.transition('error');
        reject(new Error('SSE connection timeout'));
      }, 30_000);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        this.eventSource = null;
        if (this.phase === 'connecting') {
          this.transition('error');
          reject(new Error('SSE connection failed'));
        } else {
          this.transition('error');
          this.options.onError(this.conversationId, 'SSE connection lost');
        }
      });

      eventSource.addEventListener('message', event => {
        clearTimeout(timeout);

        try {
          const msg: SSEMessage = JSON.parse(event.data);

          if (msg.type === 'connected') {
            this.transition('connected');
            resolve();
            return;
          }

          if (msg.type === 'heartbeat') {
            return;
          }

          if (msg.type === 'session_error') {
            this.transition('error');
            eventSource.close();
            this.eventSource = null;
            this.options.onError(this.conversationId, msg.error);
            reject(new Error(msg.error));
            return;
          }

          if (msg.type === 'session_replaced') {
            this.transition('idle');
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

  addMessageFSM(msgId: string, message: Message): MessageFSM {
    let fsm = this.messageFSMs.get(msgId);
    if (!fsm) {
      fsm = new MessageFSM(msgId, message, {
        onPhaseChange: (id, phase) => this.onMessagePhaseChange(id, phase),
      });
      this.messageFSMs.set(msgId, fsm);
    } else {
      fsm.setMessage(message);
    }
    return fsm;
  }

  removeMessageFSM(msgId: string): void {
    this.messageFSMs.delete(msgId);
  }

  getMessageFSM(messageId: string): MessageFSM | undefined {
    return this.messageFSMs.get(messageId);
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
        this.transition('canceled');
        this.closeEventSource();
        // Notify all active MessageFSMs to close
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
    // Can only cancel when active
    if (this.phase !== 'active') return;

    // Find all cancelable MessageFSMs
    const cancelable = Array.from(this.messageFSMs.values()).filter(
      fsm => fsm.canCancel,
    );

    if (cancelable.length === 0) return;

    // Mark all as canceling
    for (const fsm of cancelable) {
      fsm.cancel();
    }
    this.transition('canceling');

    try {
      await sendCancelApi();
      this.transition('canceled');
    } catch (e) {
      // 404 means session already gone
      if (e instanceof Error && e.message.includes('404')) {
        this.transition('canceled');
      } else {
        this.transition('error');
        throw e;
      }
    } finally {
      this.closeEventSource();
      // Refresh messages to get final state
      this.options.onRefreshMessages(this.conversationId);
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  private handleEvent(event: AgentEvent): void {
    // Dispatch to MessageFSM(s)
    // For single message, dispatch to the first active FSM
    const activeFsm = this.getFirstActiveFSM();
    if (activeFsm) {
      activeFsm.handleEvent(event);
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
      if (!fsm.isTerminal) return fsm;
    }
    // If no active FSM, return the first one (may be placeholder)
    return this.messageFSMs.values().next().value;
  }

  private onMessagePhaseChange(_msgId: string, _phase: MessagePhase): void {
    const hasActive = Array.from(this.messageFSMs.values()).some(
      fsm => !fsm.isTerminal,
    );

    if (hasActive && this.phase === 'connected') {
      this.transition('active');
    } else if (!hasActive && this.phase === 'active') {
      this.transition('connected');
    }
  }

  private transition(to: ConversationPhase): void {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return;
    this.phase = to;
  }

  private closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private reset(): void {
    this.closeEventSource();
    this.phase = 'idle';
    this.messageFSMs.clear();
  }
}
