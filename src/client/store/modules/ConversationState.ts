import { AgentEvent, ChatPhase, SSEMessage } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { makeAutoObservable } from 'mobx';

const TYPEWRITER_CHUNK_SIZE = 3;
const TYPEWRITER_INTERVAL = 15;
const TYPEWRITER_MAX_WAIT = 10_000;

/**
 * ConversationState - runtime state container for a single conversation
 * Manages SSE connection, phase transitions, and typewriter buffer
 */
export class ConversationState {
  // === Observable state ===
  phase: ChatPhase = 'idle';
  phaseError: string | null = null;
  buffer = '';
  pendingMessageIds: string[] = [];
  streamingMessage: Message | null = null;

  // === Non-observable technical details ===
  eventSource: EventSource | null = null;
  timer: ReturnType<typeof setInterval> | null = null;

  private typewriterStartTime: number | null = null;

  constructor() {
    makeAutoObservable<this, 'eventSource' | 'timer' | 'typewriterStartTime'>(
      this,
      {
        eventSource: false,
        timer: false,
        typewriterStartTime: false,
      },
    );
  }

  get isLoading(): boolean {
    return (
      this.phase !== 'idle' &&
      this.phase !== 'error' &&
      this.phase !== 'cancelled'
    );
  }

  get hasContent(): boolean {
    return (
      (this.streamingMessage?.content?.length ?? 0) > 0 ||
      this.buffer.length > 0
    );
  }

  // === Phase transitions ===

  transition(to: ChatPhase): void {
    // Terminal states are idempotent
    if (
      this.phase === 'idle' ||
      this.phase === 'error' ||
      this.phase === 'cancelled'
    ) {
      if (to !== 'connecting') return;
    }

    this.phase = to;
  }

  setPhase(phase: ChatPhase, error?: string): void {
    this.phase = phase;
    if (error !== undefined) {
      this.phaseError = error;
    }
  }

  // === SSE Connection ===

  setEventSource(es: EventSource | null): void {
    this.eventSource = es;
  }

  closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // === Message management ===

  setStreamingMessage(msg: Message | null): void {
    this.streamingMessage = msg;
  }

  addPendingMessageId(id: string): void {
    this.pendingMessageIds.push(id);
  }

  clearPendingMessageIds(): void {
    this.pendingMessageIds = [];
  }

  // === Buffer & Typewriter ===

  appendBuffer(content: string): void {
    this.buffer += content;

    if (!this.timer) {
      this.timer = setInterval(() => this.flushChunk(), TYPEWRITER_INTERVAL);
    }
  }

  private flushChunk(): void {
    if (this.buffer.length === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    const chunk = this.buffer.slice(0, TYPEWRITER_CHUNK_SIZE);
    this.buffer = this.buffer.slice(TYPEWRITER_CHUNK_SIZE);

    if (this.streamingMessage) {
      this.streamingMessage = {
        ...this.streamingMessage,
        content: this.streamingMessage.content + chunk,
      };
    }
  }

  flushBufferImmediately(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.buffer.length > 0 && this.streamingMessage) {
      this.streamingMessage = {
        ...this.streamingMessage,
        content: this.streamingMessage.content + this.buffer,
      };
      this.buffer = '';
    }
  }

  waitForTypewriter(onComplete: () => void): void {
    this.typewriterStartTime = Date.now();

    const checkBuffer = () => {
      const elapsed = Date.now() - (this.typewriterStartTime ?? 0);

      // Timeout - flush remaining
      if (elapsed >= TYPEWRITER_MAX_WAIT) {
        this.flushBufferImmediately();
        this.typewriterStartTime = null;
        onComplete();
        return;
      }

      if (!this.timer && this.buffer.length === 0) {
        this.typewriterStartTime = null;
        onComplete();
      } else {
        setTimeout(checkBuffer, 50);
      }
    };

    setTimeout(checkBuffer, 50);
  }

  // === Event handling ===

  appendEvent(event: AgentEvent): void {
    if (!this.streamingMessage) return;

    const events = [...(this.streamingMessage.meta?.events ?? []), event];
    this.streamingMessage = {
      ...this.streamingMessage,
      meta: {
        ...this.streamingMessage.meta,
        events,
      },
    };
  }

  // === Cleanup ===

  reset(): void {
    this.closeEventSource();
    this.flushBufferImmediately();
    this.phase = 'idle';
    this.phaseError = null;
    this.streamingMessage = null;
    this.pendingMessageIds = [];
    this.typewriterStartTime = null;
  }
}

/**
 * Type guard to check if SSEMessage is a control message
 */
export function isControlMessage(
  msg: SSEMessage,
): msg is
  | { type: 'connected'; conversationId: string }
  | { type: 'heartbeat' }
  | { type: 'session_error'; error: string } {
  return (
    msg.type === 'connected' ||
    msg.type === 'heartbeat' ||
    msg.type === 'session_error'
  );
}
