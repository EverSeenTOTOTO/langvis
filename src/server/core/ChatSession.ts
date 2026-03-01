import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type { Agent } from './agent';
import { ExecutionContext } from './context';
import type { Memory } from './memory';
import type Logger from '../utils/logger';
import type { SSEConnection } from '../service/SSEService';

export type SessionPhase = 'waiting' | 'running' | 'done';

export interface ChatSessionOptions {
  idleTimeoutMs: number;
  logger: typeof Logger;
  onDispose: (conversationId: string) => void;
}

export interface RunDeps {
  finalizeMessage: (ctx: ExecutionContext) => Promise<void>;
}

const VALID_TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  waiting: ['running', 'done'],
  running: ['done'],
  done: [],
};

/**
 * ChatSession - autonomous work unit for a single chat session.
 * Owns both state (SSE connection, phase, abort signal) and behavior (Agent execution loop).
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

  async run(
    agent: Agent,
    memory: Memory,
    assistantMessage: Message,
    config: unknown,
    deps: RunDeps,
  ): Promise<void> {
    const controller = new AbortController();
    const ctx = new ExecutionContext(assistantMessage, controller);
    this.ctx = ctx;
    this.transition('running');

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(memory, ctx, config)) {
        if (ctx.signal.aborted) break;

        if (event.type === 'stream' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.options.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${this.conversationId}`,
          );
        }

        if (!this.sendEvent(event)) {
          this.options.logger.warn(
            `SSE not writable for ${this.conversationId}, aborting`,
          );
          ctx.abort('SSE connection lost');
          break;
        }

        if (event.type === 'error') break;
      }
    } catch (err) {
      this.options.logger.error(
        `Agent error: ${(err as Error)?.message || String(err)} session=${this.conversationId}`,
      );
      const errorEvent = ctx.agentErrorEvent(
        (err as Error)?.message || String(err),
      );
      this.sendEvent(errorEvent);
    } finally {
      if (ctx.signal.aborted) {
        this.options.logger.info(
          `Agent cancelled: reason=${(ctx.signal.reason as Error)?.message ?? 'Unknown'} session=${this.conversationId}`,
        );
        const cancelledEvent = ctx.agentCancelledEvent(
          (ctx.signal.reason as Error)?.message ?? 'Unknown',
        );
        this.sendEvent(cancelledEvent);
      }

      await deps.finalizeMessage(ctx);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const avgTokenTime =
        ctx.message.content.length > 0
          ? totalTime / ctx.message.content.length
          : 0;
      this.options.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${ctx.message.content.length} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${this.conversationId}`,
      );

      this.cleanup();
    }
  }

  cancel(reason: string): void {
    if (this.ctx && !this.ctx.signal.aborted) {
      this.ctx.abort(reason);
    }
  }

  handleDisconnect(): void {
    if (this._phase === 'running') {
      this.cancel('Client disconnected');
    } else {
      this.cleanup();
    }
  }

  sendEvent(event: AgentEvent): boolean {
    if (!this.sseConnection?.response?.writable) return false;

    const data = `data: ${JSON.stringify(event)}\n\n`;
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
    this.sseConnection.response.write(`data: ${JSON.stringify(msg)}\n\n`);
    this.sseConnection.response.flush();
  }

  cleanup(): void {
    this.transition('done');
  }
}
