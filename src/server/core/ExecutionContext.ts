import { InjectTokens } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { generateId } from '@/shared/utils';
import type { RedisClientType } from 'redis';
import { container } from 'tsyringe';

export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
}

/**
 * ExecutionContext - pure execution context for Agent/Tool execution.
 *
 * Design principle: lightweight and pure - only contains execution control,
 * trace identifiers, seq generation, and callId stack management.
 * No data persistence, content accumulation, or SSE sending.
 */
export class ExecutionContext {
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public readonly traceId: string;

  private seqCounter = 0;
  private callIdStack: string[] = [];
  private cachedKeys: string[] = [];

  constructor(
    traceId: string,
    private readonly controller: AbortController,
  ) {
    this.traceId = traceId;
  }

  private nextSeq(): number {
    return ++this.seqCounter;
  }

  private nextCallId(): string {
    return generateId('tc');
  }

  get currentCallId(): string {
    return this.callIdStack.at(-1)!;
  }

  private pushCallId(): string {
    const callId = this.nextCallId();
    this.callIdStack.push(callId);
    return callId;
  }

  private popCallId(): void {
    this.callIdStack.pop();
  }

  abort(reason: string): void {
    this.controller.abort(new Error(reason));
  }

  // === Event factories (return event objects, no persistence) ===

  agentStartEvent(): AgentEvent {
    return {
      type: 'start',
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentThoughtEvent(content: string): AgentEvent {
    return {
      type: 'thought',
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentStreamEvent(content: string): AgentEvent {
    return {
      type: 'stream',
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentFinalEvent(): AgentEvent {
    return {
      type: 'final',
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentCancelledEvent(reason: string): AgentEvent {
    return {
      type: 'cancelled',
      reason,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentErrorEvent(error: string): AgentEvent {
    return {
      type: 'error',
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolCallEvent(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AgentEvent {
    const callId = this.pushCallId();
    return {
      type: 'tool_call',
      callId,
      toolName,
      toolArgs,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolProgressEvent(toolName: string, data: unknown): AgentEvent {
    return {
      type: 'tool_progress',
      callId: this.currentCallId,
      toolName,
      data,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolResultEvent(toolName: string, output: unknown): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_result',
      callId: this.currentCallId,
      toolName,
      output,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.popCallId();
    return event;
  }

  agentToolErrorEvent(toolName: string, error: string): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_error',
      callId: this.currentCallId,
      toolName,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.popCallId();
    return event;
  }

  // === Cache management ===

  private static readonly STRING_THRESHOLD = 1000;
  private static readonly COLLECTION_THRESHOLD = 20;

  /**
   * Compress a value to Redis cache
   */
  async compress(
    value: unknown,
    options?: { preview?: number },
  ): Promise<CachedReference> {
    const key = generateId('cache');
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    const redis = container.resolve<RedisClientType>(InjectTokens.REDIS);
    await redis.setEx(`agent:cache:${this.traceId}:${key}`, 3600, serialized);
    this.cachedKeys.push(key);

    return {
      $cached: key,
      $size: Buffer.byteLength(serialized, 'utf8'),
      $preview:
        typeof value === 'string'
          ? value.slice(0, options?.preview ?? 200)
          : undefined,
    };
  }

  /**
   * Retrieve a cached value from Redis
   * @throws Error if cache miss
   */
  async retrieve(key: string): Promise<unknown> {
    const redis = container.resolve<RedisClientType>(InjectTokens.REDIS);
    const data = await redis.get(`agent:cache:${this.traceId}:${key}`);
    if (!data) {
      throw new Error(`Cache miss: ${key}`);
    }
    return data;
  }

  /**
   * Clear all cached data for this session
   */
  async clearCache(): Promise<void> {
    if (this.cachedKeys.length > 0) {
      const redis = container.resolve<RedisClientType>(InjectTokens.REDIS);
      const keys = this.cachedKeys.map(k => `agent:cache:${this.traceId}:${k}`);
      await redis.del(keys);
      this.cachedKeys = [];
    }
  }

  // === Auto compress/resolve for tool I/O ===

  /**
   * Check if a value should be compressed
   * - string: length > 1000
   * - array/object: keys/items > 20
   */
  private shouldCompress(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.length > ExecutionContext.STRING_THRESHOLD;
    }
    if (Array.isArray(value)) {
      return value.length > ExecutionContext.COLLECTION_THRESHOLD;
    }
    if (value && typeof value === 'object') {
      return Object.keys(value).length > ExecutionContext.COLLECTION_THRESHOLD;
    }
    return false;
  }

  /**
   * Automatically compress large values in output
   */
  async autoCompressOutput(output: unknown): Promise<unknown> {
    if (this.shouldCompress(output)) {
      return this.compress(output);
    }

    if (Array.isArray(output)) {
      return Promise.all(output.map(item => this.autoCompressOutput(item)));
    }

    if (output && typeof output === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(output)) {
        result[k] = await this.autoCompressOutput(v);
      }
      return result;
    }

    return output;
  }

  /**
   * Automatically resolve CachedReference in input
   */
  async autoResolveInput(input: unknown): Promise<unknown> {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      if (
        '$cached' in input &&
        typeof (input as Record<string, unknown>).$cached === 'string'
      ) {
        return this.retrieve((input as CachedReference).$cached);
      }
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        result[k] = await this.autoResolveInput(v);
      }
      return result;
    }

    if (Array.isArray(input)) {
      return Promise.all(input.map(item => this.autoResolveInput(item)));
    }

    return input;
  }
}
