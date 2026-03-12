import { ChatPhase, SSEMessage } from '@/shared/types';
import { isClient } from '@/shared/utils';
import { makeAutoObservable } from 'mobx';
import { getPrefetchPath } from '../../decorator/api';

const VALID_TRANSITIONS: Record<ChatPhase, ChatPhase[]> = {
  idle: ['connecting'],
  connecting: ['streaming', 'error', 'cancelled'],
  streaming: ['finishing', 'error', 'cancelled'],
  finishing: ['idle', 'error'],
  error: [],
  cancelled: [],
};

export interface ChatSessionOptions {
  onEvent: (event: SSEMessage) => void;
  onError: (error: string) => void;
}

export class ChatSession {
  readonly conversationId: string;

  // === Observable state ===
  phase: ChatPhase = 'idle';
  phaseError: string | null = null;

  // === Non-observable technical details ===
  private eventSource: EventSource | null = null;
  private options: ChatSessionOptions;

  constructor(conversationId: string, options: ChatSessionOptions) {
    this.conversationId = conversationId;
    this.options = options;
    makeAutoObservable<this, 'eventSource' | 'options'>(this, {
      eventSource: false,
      options: false,
    });
  }

  get isLoading(): boolean {
    return (
      this.phase !== 'idle' &&
      this.phase !== 'error' &&
      this.phase !== 'cancelled'
    );
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
        reject(new Error('SSE connection timeout'));
      }, 30_000);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        this.eventSource = null;
        reject(new Error('SSE connection failed'));
      });

      eventSource.addEventListener('message', event => {
        clearTimeout(timeout);

        try {
          const msg: SSEMessage = JSON.parse(event.data);

          // Wait for 'connected' handshake
          if (msg.type === 'connected') {
            resolve();
            return;
          }

          if (msg.type === 'heartbeat') {
            return;
          }

          if (msg.type === 'session_error') {
            this.transition('error', msg.error);
            eventSource.close();
            this.eventSource = null;
            this.options.onError(msg.error);
            reject(new Error(msg.error));
            return;
          }

          // Business event
          this.handleEvent(msg as SSEMessage & { type: string });
        } catch (e) {
          this.options.onError(
            `Failed parsing SSE message: ${(e as Error).message}`,
          );
        }
      });
    });
  }

  cancel(): void {
    if (!this.isLoading) return;

    this.transition('cancelled');
    this.closeEventSource();
  }

  private handleEvent(msg: SSEMessage & { type: string }): void {
    switch (msg.type) {
      case 'final':
        this.transition('idle');
        this.closeEventSource();
        break;

      case 'cancelled':
        this.transition('cancelled');
        this.closeEventSource();
        break;

      case 'error':
        this.transition('error', msg.error);
        this.closeEventSource();
        break;

      case 'session_replaced':
        this.transition('idle');
        this.closeEventSource();
        break;

      default:
        // Any other business event means Agent is running.
        // This handles reconnection where 'start' was already emitted.
        this.transition('streaming');
        break;
    }

    this.options.onEvent(msg as SSEMessage);
  }

  fail(error: string): void {
    if (this.phase === 'cancelled') return;

    this.transition('error', error);
    this.closeEventSource();
  }

  disconnect(): void {
    this.closeEventSource();
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  // === Internal methods ===

  private transition(to: ChatPhase, error?: string): void {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return;

    this.phase = to;
    if (error !== undefined) {
      this.phaseError = error;
    }
  }

  private closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private reset(): void {
    this.closeEventSource();
    this.phase = 'idle';
    this.phaseError = null;
  }
}
