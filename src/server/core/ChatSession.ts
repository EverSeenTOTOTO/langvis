import type { Message } from '@/shared/types/entities';
import { AgentEvent } from '@/shared/types';
import type { PendingMessage } from './PendingMessage';
import { SSEConnection } from './SSEConnection';
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

export class ChatSession {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private sseConnection: SSEConnection | null = null;
  private pendingMessage: PendingMessage | null = null;
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

  get message(): Message {
    if (!this.pendingMessage) {
      throw new Error('Message not initialized');
    }
    return this.pendingMessage.toMessage();
  }

  private transition(to: SessionPhase): boolean {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return false;

    this.phase = to;

    if (to === 'running') {
      clearTimeout(this.idleTimeout);
    }

    if (to === 'done') {
      clearTimeout(this.idleTimeout);
      this.sseConnection?.close();
      this.sseConnection = null;
      this.pendingMessage = null;
      this.options.onDispose(this.conversationId);
    }

    return true;
  }

  bindConnection(connection: SSEConnection): void {
    this.sseConnection = connection;
  }

  bindPendingMessage(pendingMessage: PendingMessage): void {
    this.pendingMessage = pendingMessage;
  }

  async run(agent: Agent, memory: Memory, config: unknown): Promise<void> {
    if (!this.pendingMessage) {
      throw new Error('PendingMessage not bound');
    }

    const message = this.pendingMessage.toMessage();
    const controller = new AbortController();
    const ctx = new ExecutionContext(message.id, controller);
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

        this.pendingMessage.handleEvent(event);

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
      await this.finalizeRun(ctx, startTime, firstTokenTime);
    }
  }

  private handleAgentError(err: unknown, ctx: ExecutionContext): void {
    logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${this.conversationId}`,
    );
    const errorEvent = ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    this.pendingMessage!.handleEvent(errorEvent);
    this.send(errorEvent);
  }

  private async finalizeRun(
    ctx: ExecutionContext,
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
      this.pendingMessage!.handleEvent(cancelledEvent);
      this.send(cancelledEvent);
    }

    await this.pendingMessage!.finalize();

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : null;
    const avgTokenTime =
      this.pendingMessage!.contentLength > 0
        ? totalTime / this.pendingMessage!.contentLength
        : 0;
    logger.info(
      `Agent completed: totalTime=${totalTime}ms tokens=${this.pendingMessage!.contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${this.conversationId}`,
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
    if (!this.sseConnection?.isWritable) return false;
    return this.sseConnection.send(event as AgentEvent);
  }

  cleanup(): void {
    this.transition('done');
  }
}
