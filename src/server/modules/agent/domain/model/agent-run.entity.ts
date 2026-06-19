import { RuntimeConfigVO } from './runtime-config.vo';
import type { LlmMessage } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import type { EnrichedEvent } from '@/shared/types/events';
import { RunAlreadyCompletedError, ToolNotFoundError } from '../errors';
import type { Agent } from './agent.base';
import { ToolCall } from './tool-call.entity';
import type { MemoryPort } from '@/server/modules/memory/domain/port/memory.port';
import type { LlmPort } from '../port/llm.port';
import type { CachePort } from '../port/cache.port';
import { AggregateRoot } from '@/server/libs/ddd';
import { EventEmitter } from 'events';

/**
 * AgentRun — 聚合根。
 *
 * 驱动 agent.call(this) 循环，通过 EventEmitter 组合发布流式事件。
 * 继承 AggregateRoot 以确立聚合边界（ToolCall 是其内部实体）。
 * 领域事件机制 (addEvent) 留给生命周期状态变更，
 * 流式推送 (emitter.emit) 用于实时 SSE。
 */
export class AgentRun extends AggregateRoot<string> {
  // ── 身份别名 ──
  readonly messageId: string;
  get runId(): string {
    return this.id;
  }

  // ── 配置快照 ──
  readonly config: RuntimeConfigVO;

  // ── 取消控制 ──
  private abortController = new AbortController();
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  // ── 内部执行控制 ──
  private seq = 0;
  #terminated = false;

  // ── 流式推送 ──
  private emitter = new EventEmitter();

  // ── 依赖 ──
  readonly agent: Agent;
  readonly workDir: string;
  private memory: MemoryPort;
  readonly cache: CachePort;
  readonly llm: LlmPort;

  constructor(
    runId: string,
    messageId: string,
    workDir: string,
    config: RuntimeConfigVO,
    agent: Agent,
    memory: MemoryPort,
    cache: CachePort,
    llm: LlmPort,
  ) {
    super(runId);
    this.messageId = messageId;
    this.workDir = workDir;
    this.config = config;
    this.agent = agent;
    this.memory = memory;
    this.cache = cache;
    this.llm = llm;
  }

  // ════════════════════════════════════════
  // EventEmitter 代理 — 流式推送
  // ════════════════════════════════════════

  on(event: string, handler: (...args: any[]) => void): this {
    this.emitter.on(event, handler);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void): this {
    this.emitter.off(event, handler);
    return this;
  }

  // ════════════════════════════════════════
  // 执行入口
  // ════════════════════════════════════════

  async execute(): Promise<void> {
    this.enrichAndEmit({ type: 'start' });
    try {
      for await (const _ of this.agent.call(this)) {
        if (this.signal.aborted) break;
      }
      if (!this.#terminated) {
        this.emitContextUsage();
        this.complete();
      }
    } catch (err) {
      if (this.signal.aborted) return;
      this.fail((err as Error)?.message || String(err));
    }
  }

  // ════════════════════════════════════════
  // Memory 代理
  // ════════════════════════════════════════

  async buildContext(): Promise<LlmMessage[]> {
    return this.memory.buildContext();
  }

  // ════════════════════════════════════════
  // 工具执行
  // ════════════════════════════════════════

  async *executeTool(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AsyncGenerator<EnrichedEvent, string, void> {
    let tool;
    try {
      tool = container.resolve(toolName) as ToolCall['tool'];
    } catch {
      throw new ToolNotFoundError(toolName);
    }

    const toolCall = new ToolCall(
      generateId('tc'),
      tool,
      toolArgs,
      this.cache,
      this,
    );

    yield* toolCall.execute();

    return toolCall.observation;
  }

  // ════════════════════════════════════════
  // 生命周期方法 — emit 并返回（兼容 Agent yield）
  // ════════════════════════════════════════

  emitTextChunk(chunk: string): EnrichedEvent {
    return this.enrichAndEmit({ type: 'text_chunk', content: chunk });
  }

  emitThought(content: string): EnrichedEvent {
    return this.enrichAndEmit({ type: 'thought', content });
  }

  emitToolCall(
    callId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): EnrichedEvent {
    return this.enrichAndEmit({
      type: 'tool_call',
      callId,
      toolName,
      toolArgs,
    });
  }

  emitToolProgress(callId: string, data: unknown): EnrichedEvent {
    return this.enrichAndEmit({ type: 'tool_progress', callId, data });
  }

  emitToolResult(
    callId: string,
    toolName: string,
    output: unknown,
  ): EnrichedEvent {
    return this.enrichAndEmit({
      type: 'tool_result',
      callId,
      toolName,
      output,
    });
  }

  emitToolError(
    callId: string,
    toolName: string,
    error: string,
  ): EnrichedEvent {
    return this.enrichAndEmit({ type: 'tool_error', callId, toolName, error });
  }

  complete(): EnrichedEvent {
    if (this.#terminated) throw new RunAlreadyCompletedError(this.id);
    this.#terminated = true;
    return this.enrichAndEmit({ type: 'final' });
  }

  cancel(reason: string): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.abortController.abort(reason);
    this.enrichAndEmit({ type: 'cancelled', reason });
  }

  fail(error: string): EnrichedEvent {
    if (this.#terminated) throw new RunAlreadyCompletedError(this.id);
    this.#terminated = true;
    return this.enrichAndEmit({ type: 'error', error });
  }

  get isTerminated(): boolean {
    return this.#terminated;
  }

  // ── 内部 ──

  private emitContextUsage(): void {
    const { used, total } = this.memory.getContextUsage();
    this.enrichAndEmit({
      type: 'context_usage',
      used,
      total,
      reason: 'turn_completed',
    });
  }

  private enrichAndEmit(event: any): EnrichedEvent {
    const enriched: EnrichedEvent = {
      ...event,
      runId: this.id,
      seq: ++this.seq,
      at: Date.now(),
    };
    this.emitter.emit('run:event', enriched);
    return enriched;
  }
}
