import type { Message } from '@/shared/types/entities';
import { AgentEvent } from '@/shared/types';
import type { SSEConnection } from '../service/SSEService';
import logger from '../utils/logger';
import type { Agent } from './agent';
import { ExecutionContext } from './ExecutionContext';
import type { Memory } from './memory';

export type SessionPhase = 'waiting' | 'running' | 'done';

export interface ChatSessionOptions {
  idleTimeoutMs: number;
  onDispose: (conversationId: string) => void;
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

  private sseConnection: SSEConnection | null = null;
  private idleTimeout!: ReturnType<typeof setTimeout>;

  ctx: ExecutionContext | null = null;
  phase: SessionPhase = 'waiting';

  constructor(
    conversationId: string,
    private readonly options: ChatSessionOptions,
  ) {
    this.conversationId = conversationId;
    this.idleTimeout = setTimeout(() => {
      if (this.phase === 'waiting') {
        logger.warn(
          `Session ${this.conversationId} idle timeout after ${this.options.idleTimeoutMs}ms`,
        );
        this.cleanup();
      }
    }, this.options.idleTimeoutMs);
  }

  private transition(to: SessionPhase): boolean {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return false;

    this.phase = to;

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
    finalizeMessage: (ctx: ExecutionContext) => Promise<void>,
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
          logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${this.conversationId}`,
          );
        }

        if (!this.send(event)) {
          logger.warn(`SSE not writable for ${this.conversationId}, aborting`);
          ctx.abort('SSE connection lost');
          break;
        }

        if (event.type === 'error') break;
      }
    } catch (err) {
      this.handleAgentError(err, ctx);
    } finally {
      await this.finalizeRun(ctx, finalizeMessage, startTime, firstTokenTime);
    }
  }

  private handleAgentError(err: unknown, ctx: ExecutionContext): void {
    logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${this.conversationId}`,
    );
    const errorEvent = ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    this.send(errorEvent);
  }

  private async finalizeRun(
    ctx: ExecutionContext,
    finalizeMessage: (ctx: ExecutionContext) => Promise<void>,
    startTime: number,
    firstTokenTime: number | undefined,
  ): Promise<void> {
    if (ctx.signal.aborted) {
      logger.info(
        `Agent cancelled: reason=${(ctx.signal.reason as Error)?.message ?? 'Unknown'} session=${this.conversationId}`,
      );
      const cancelledEvent = ctx.agentCancelledEvent(
        (ctx.signal.reason as Error)?.message ?? 'Unknown',
      );
      this.send(cancelledEvent);
    }

    await finalizeMessage(ctx);

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : null;
    const avgTokenTime =
      ctx.message.content.length > 0
        ? totalTime / ctx.message.content.length
        : 0;
    logger.info(
      `Agent completed: totalTime=${totalTime}ms tokens=${ctx.message.content.length} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${this.conversationId}`,
    );

    this.cleanup();
  }

  cancel(reason: string): void {
    if (this.ctx && !this.ctx.signal.aborted) {
      this.ctx.abort(reason);
    }
  }

  handleDisconnect(): void {
    if (this.phase === 'running') {
      this.cancel('Client disconnected');
    } else {
      this.cleanup();
    }
  }

  send(event: AgentEvent | { type: string; [key: string]: unknown }): boolean {
    if (!this.sseConnection?.response?.writable) return false;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const flushed = this.sseConnection.response.write(payload);
    this.sseConnection.response.flush();

    if (!flushed) {
      logger.warn(`Backpressure on SSE write for ${this.conversationId}`);
    }

    return !!flushed;
  }

  cleanup(): void {
    this.transition('done');
  }
}
