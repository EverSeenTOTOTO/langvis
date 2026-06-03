import type { EffectiveConfig, RunStatus } from '@/shared/types/agent';
import type { ToolCallRecord, RunSnapshot } from '@/shared/types/render';
import type { LlmMessage, Message } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import type { EnrichedEvent } from './agent.types';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import { RunAlreadyCompletedError, ToolNotFoundError } from './agent.errors';
import type { Agent } from './agent.base';
import { ToolCall } from './tool-call.entity';
import type { MemoryService } from '@/server/modules/memory/domain/memory-service';
import type { ContextUsage } from '@/server/modules/memory/domain/memory.types';
import type { ChatLlm } from './chat-llm';
import { CacheService } from '@/server/modules/memory/services/cache.service';
import { AggregateRoot } from '@/server/libs/ddd';
import type { DomainEvent } from '@/server/libs/ddd';

/**
 * AgentRun — Agent 上下文的核心聚合根。
 *
 * 拥有自己的执行生命周期：execute() 驱动 agent.call(this)，
 * Agent 通过 run.llm 访问预绑定的 ChatLlm，通过 run.executeTool() 执行工具。
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
  readonly agent: Agent;
  readonly workDir: string;
  private memory: MemoryService;
  private cache: CacheService;
  readonly llm: ChatLlm;
  private historyMessages: Message[];

  constructor(
    runId: string,
    messageId: string,
    workDir: string,
    config: EffectiveConfig,
    agent: Agent,
    memory: MemoryService,
    cache: CacheService,
    llm: ChatLlm,
    historyMessages: Message[],
  ) {
    super(runId);
    this.runId = runId;
    this.messageId = messageId;
    this.workDir = workDir;
    this.config = config;
    this.agent = agent;
    this.memory = memory;
    this.cache = cache;
    this.llm = llm;
    this.historyMessages = historyMessages;
  }

  // ════════════════════════════════════════
  // 执行入口 — AgentRun 驱动自己的生命周期
  // ════════════════════════════════════════

  async *execute(): AsyncGenerator<
    EnrichedEvent | AgentEvent | StreamChunk,
    void,
    void
  > {
    try {
      yield this.start();
      yield* this.agent.call(this);
      if (!this.isTerminated) {
        yield this.complete();
      }
    } catch (err) {
      if (this.signal.aborted) return;
      yield this.fail((err as Error)?.message || String(err));
    }
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
    return this.memory.summarize(this.historyMessages, {
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
    return this.memory.estimateUsage(
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
   * 直接通过 container.resolve(toolName) 解析工具实例。
   */
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

    const callId = generateId('tc');
    const toolCall = new ToolCall(callId, tool, toolArgs, this.cache, {
      signal: this.signal,
      workDir: this.workDir,
      messageId: this.messageId,
      runId: this.runId,
    });
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
