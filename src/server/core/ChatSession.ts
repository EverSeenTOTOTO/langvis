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
 * ChatSession - autonomous work unit for a single SSE chat session.
 * Owns both state (message, SSE connection, phase) and behavior (Agent execution loop).
 */
export class ChatSession {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private sseConnection: SSEConnection | null = null;
  private idleTimeout!: ReturnType<typeof setTimeout>;

  private _message: Message | null = null;
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
    if (!this._message) {
      throw new Error('Message not initialized');
    }
    return this._message;
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
    finalizeMessage: (message: Message) => Promise<void>,
  ): Promise<void> {
    this._message = assistantMessage;

    const controller = new AbortController();
    const ctx = new ExecutionContext(assistantMessage.id, controller);
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

        this.handleEvent(event);

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

  /**
   * Handle event: accumulate content + persist event + send SSE
   */
  private handleEvent(event: AgentEvent): void {
    // 1. Accumulate stream content to message
    if (event.type === 'stream') {
      this._message!.content += event.content;
    }

    // 2. Persist non-stream events to message.meta.events
    if (event.type !== 'stream') {
      if (!this._message!.meta) {
        this._message!.meta = {};
      }
      if (!this._message!.meta.events) {
        this._message!.meta.events = [];
      }
      this._message!.meta.events.push(event);
    }

    // 3. Special handling for error event - set content
    if (event.type === 'error') {
      this._message!.content = event.error;
    }

    // SSE sending is done separately in the run loop
  }

  private handleAgentError(err: unknown, ctx: ExecutionContext): void {
    logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${this.conversationId}`,
    );
    const errorEvent = ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    this.handleEvent(errorEvent);
    this.send(errorEvent);
  }

  private async finalizeRun(
    ctx: ExecutionContext,
    finalizeMessage: (message: Message) => Promise<void>,
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
      this.handleEvent(cancelledEvent);
      this.send(cancelledEvent);
    }

    await finalizeMessage(this._message!);

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : null;
    const avgTokenTime =
      this._message!.content.length > 0
        ? totalTime / this._message!.content.length
        : 0;
    logger.info(
      `Agent completed: totalTime=${totalTime}ms tokens=${this._message!.content.length} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${this.conversationId}`,
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
