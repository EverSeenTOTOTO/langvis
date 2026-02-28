import { AgentEvent } from '@/shared/types';
import { ExecutionContext } from './context';
import Logger from '../utils/logger';
import type { SSEConnection } from '../service/SSEService';

export type SessionPhase = 'waiting' | 'running' | 'done';

export interface ChatSessionOptions {
  idleTimeoutMs: number;
  logger: typeof Logger;
  onDispose: (conversationId: string) => void;
}

const VALID_TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  waiting: ['running', 'done'],
  running: ['done'],
  done: [],
};

/**
 * ChatSession - runtime state container for a single chat session
 * Manages SSE connection, abort signal, and phase transitions
 */
export class ChatSession {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private _phase: SessionPhase = 'waiting';
  private sseConnection: SSEConnection | null = null;
  private idleTimeout: ReturnType<typeof setTimeout>;

  ctx: ExecutionContext | null = null;

  get phase(): SessionPhase {
    return this._phase;
  }

  constructor(
    conversationId: string,
    private readonly options: ChatSessionOptions,
  ) {
    this.conversationId = conversationId;

    this.idleTimeout = setTimeout(() => {
      if (this._phase === 'waiting') {
        this.options.logger.warn(
          `Session ${conversationId} idle timeout after ${this.options.idleTimeoutMs}ms`,
        );
        this.cleanup();
      }
    }, this.options.idleTimeoutMs);
  }

  private transition(to: SessionPhase): boolean {
    if (!VALID_TRANSITIONS[this._phase].includes(to)) return false;

    this._phase = to;

    if (to === 'running') {
      clearTimeout(this.idleTimeout);
    }

    if (to === 'done') {
      clearTimeout(this.idleTimeout);
      if (this.sseConnection) {
        if (this.sseConnection.heartbeat) {
          clearInterval(this.sseConnection.heartbeat);
        }
        if (!this.sseConnection.response.writableEnded) {
          this.sseConnection.response.end();
        }
        this.sseConnection = null;
      }
      this.options.onDispose(this.conversationId);
    }

    return true;
  }

  bindConnection(connection: SSEConnection): void {
    this.sseConnection = connection;
  }

  start(ctx: ExecutionContext): void {
    this.ctx = ctx;
    this.transition('running');
  }

  cancel(reason: string): void {
    if (this.ctx && !this.ctx.signal.aborted) {
      this.ctx.abort(reason);
    }
  }

  /**
   * Handle client disconnect based on current phase:
   * - running: only cancel, cleanup happens in startAgent finally block
   * - waiting: cleanup immediately since no startAgent to handle it
   */
  onClientDisconnect(): void {
    if (this._phase === 'running') {
      this.cancel('Client disconnected');
    } else {
      this.cleanup();
    }
  }

  sendEvent(event: AgentEvent): boolean {
    if (!this.sseConnection?.response?.writable) return false;

    const data = `data: ${JSON.stringify(event)}

`;
    const flushed = this.sseConnection.response.write(data);
    this.sseConnection.response.flush();

    if (!flushed) {
      this.options.logger.warn(
        `Backpressure on SSE write for ${this.conversationId}`,
      );
    }

    return true;
  }

  sendControlMessage(msg: { type: string; [key: string]: unknown }): void {
    if (!this.sseConnection?.response?.writable) return;
    this.sseConnection.response.write(`data: ${JSON.stringify(msg)}

`);
    this.sseConnection.response.flush();
  }

  /**
   * Idempotent cleanup - done → done is ignored in transition()
   */
  cleanup(): void {
    this.transition('done');
  }
}
