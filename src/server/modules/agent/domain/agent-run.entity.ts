import type { EffectiveConfig, RunStatus } from '@/shared/types/agent';
import type { ToolCallRecord, RunSnapshot } from '@/shared/types/render';
import type { LlmMessage, Message } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import type { EnrichedEvent } from './agent.types';
import { RunAlreadyCompletedError, ToolNotFoundError } from './agent.errors';
import { ToolCall } from './tool-call.entity';
import type { MemoryService } from '@/server/modules/memory/domain/memory-service';
import type { ContextUsage } from '@/server/modules/memory/domain/memory.types';
import type { ToolResolver } from './tool-resolver.port';
import type { CacheResolver } from './cache-resolver.port';
import { AggregateRoot } from '@/server/libs/ddd';
import type { DomainEvent } from '@/server/libs/ddd';

/**
 * AgentRun — Agent 上下文的核心聚合根。
 *
 * 取代 ExecutionContext（事件发射 + 取消控制）+
 * PendingMessage（content 累积）+
 * MessageFSM（状态管理）。
 *
 * Agent 的唯一入口：所有状态变更通过聚合根方法进行。
 */
export class AgentRun extends AggregateRoot<string> {
  // ── 身份 ──
  readonly runId: string;
  readonly messageId: string;
  private _status: RunStatus = 'initialized';
  get status(): RunStatus {
    return this._status;
  }

  // ── 配置快照 ──
  readonly config: EffectiveConfig;

  // ── 取消控制 ──
  private abortController = new AbortController();
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  // ── 累积状态 ──
  private _content = '';
  get content(): string {
    return this._content;
  }

  private _thoughts: string[] = [];
  private _toolCalls = new Map<string, ToolCall>();
  private seq = 0;

  // ── 依赖 ──
  private memoryService: MemoryService;
  private cacheResolver: CacheResolver;
  private toolResolver: ToolResolver;
  private historyMessages: Message[];

  constructor(
    runId: string,
    messageId: string,
    config: EffectiveConfig,
    memoryService: MemoryService,
    cacheResolver: CacheResolver,
    toolResolver: ToolResolver,
    historyMessages: Message[],
  ) {
    super(runId);
    this.runId = runId;
    this.messageId = messageId;
    this.config = config;
    this.memoryService = memoryService;
    this.cacheResolver = cacheResolver;
    this.toolResolver = toolResolver;
    this.historyMessages = historyMessages;
  }

  // ════════════════════════════════════════
  // 事件缓冲（用于断线重连 replay）
  // ════════════════════════════════════════

  get bufferedEvents(): EnrichedEvent[] {
    return this.domainEvents as unknown as EnrichedEvent[];
  }

  // ════════════════════════════════════════
  // Memory 代理
  // ════════════════════════════════════════

  async summarize(): Promise<LlmMessage[]> {
    const cfg = this.config.runtimeConfig as {
      model?: { modelId?: string };
      memory?: { type?: string; windowSize?: number };
    };
    return this.memoryService.summarize(this.historyMessages, {
      windowSize: cfg.memory?.windowSize,
      systemPrompt: this.config.systemPrompt,
      memoryType: cfg.memory?.type as 'slide_window' | 'react' | undefined,
      modelId: cfg.model?.modelId,
    });
  }

  getContextUsage(): ContextUsage {
    const cfg = this.config.runtimeConfig as {
      model?: { modelId?: string };
    };
    const modelId = cfg.model?.modelId ?? '';
    return this.memoryService.estimateUsage(
      this.historyMessages as unknown as LlmMessage[],
      this.config.contextSize,
      modelId,
    );
  }

  // ════════════════════════════════════════
  // 工具执行
  // ════════════════════════════════════════

  /**
   * 创建 ToolCall 并委托执行。
   * Agent 只需：`const observation = yield* run.executeTool(name, args);`
   */
  async *executeTool(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AsyncGenerator<EnrichedEvent, string, void> {
    const tool = this.toolResolver.resolve(toolName);
    if (!tool) throw new ToolNotFoundError(toolName);

    const callId = generateId('tc');
    const toolCall = new ToolCall(
      callId,
      tool,
      toolArgs,
      this.cacheResolver.resolve(),
    );
    this._toolCalls.set(callId, toolCall);

    yield* toolCall.execute(this);

    return toolCall.observation;
  }

  // ════════════════════════════════════════
  // 生命周期方法
  // ════════════════════════════════════════

  start(): EnrichedEvent {
    this._status = 'running';
    return this.emit({ type: 'start' });
  }

  appendContent(chunk: string): EnrichedEvent {
    this._content += chunk;
    return this.emit({ type: 'text_chunk', content: chunk });
  }

  recordThought(content: string): EnrichedEvent {
    this._thoughts.push(content);
    return this.emit({ type: 'thought', content });
  }

  /** 供 ToolCall 内部调用 */
  emitToolCall(
    callId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): EnrichedEvent {
    return this.emit({ type: 'tool_call', callId, toolName, toolArgs });
  }

  emitToolProgress(callId: string, data: unknown): EnrichedEvent {
    return this.emit({ type: 'tool_progress', callId, data });
  }

  emitToolResult(
    callId: string,
    toolName: string,
    output: unknown,
  ): EnrichedEvent {
    return this.emit({ type: 'tool_result', callId, toolName, output });
  }

  emitToolError(
    callId: string,
    toolName: string,
    error: string,
  ): EnrichedEvent {
    return this.emit({ type: 'tool_error', callId, toolName, error });
  }

  complete(): EnrichedEvent {
    if (this._status !== 'running')
      throw new RunAlreadyCompletedError(this.runId);
    this._status = 'completed';
    return this.emit({ type: 'final' });
  }

  cancel(reason: string): EnrichedEvent {
    if (this._status === 'completed' || this._status === 'cancelled') {
      throw new RunAlreadyCompletedError(this.runId);
    }
    this.abortController.abort(reason);
    this._status = 'cancelled';
    return this.emit({ type: 'cancelled', reason });
  }

  fail(error: string): EnrichedEvent {
    this._status = 'failed';
    return this.emit({ type: 'error', error });
  }

  /** 供应用层 emit context_usage 时使用 */
  nextSeq(): number {
    return ++this.seq;
  }

  // ════════════════════════════════════════
  // 查询
  // ════════════════════════════════════════

  getToolCallRecords(): ToolCallRecord[] {
    return [...this._toolCalls.values()].map(tc => tc.toRecord());
  }

  getToolCall(callId: string): ToolCall | undefined {
    return this._toolCalls.get(callId);
  }

  toSnapshot(): RunSnapshot {
    return {
      runId: this.runId,
      messageId: this.messageId,
      status: this._status,
      content: this._content,
      toolCallRecords: this.getToolCallRecords(),
      thoughts: [...this._thoughts],
    };
  }

  get isTerminated(): boolean {
    return (
      this._status === 'completed' ||
      this._status === 'failed' ||
      this._status === 'cancelled'
    );
  }

  // ── 内部 ──

  private emit(event: any): EnrichedEvent {
    const enriched: EnrichedEvent = {
      ...event,
      runId: this.runId,
      seq: ++this.seq,
      at: Date.now(),
    };
    this.addEvent(enriched as unknown as DomainEvent);
    return enriched;
  }
}
