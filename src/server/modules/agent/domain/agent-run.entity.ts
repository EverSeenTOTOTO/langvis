import type { EffectiveConfig } from '@/shared/types/agent';
import type { LlmMessage, Message } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import type { EnrichedEvent } from './agent.types';
import { RunAlreadyCompletedError, ToolNotFoundError } from './agent.errors';
import type { Agent } from './agent.base';
import { ToolCall } from './tool-call.entity';
import type { MemoryService } from '@/server/modules/memory/domain/memory-service';
import type { ContextUsage } from '@/server/modules/memory/domain/memory.types';
import type { ChatLlm } from './chat-llm';
import { CacheService } from '@/server/modules/memory/services/cache.service';
import { EventEmitter } from 'events';

/**
 * AgentRun — 无状态执行器。
 *
 * 驱动 agent.call(this) 循环，通过 EventEmitter 发布事件。
 * 不累积 content / thoughts / toolCalls — 状态累积由 Conversation 聚合根内的 PendingMessage 负责。
 *
 * 生命周期方法（appendContent / recordThought 等）仍返回 EnrichedEvent
 * 以兼容 Agent 实现中的 yield 语法，但同时通过 emit('run:event') 推送给消费者。
 */
export class AgentRun extends EventEmitter {
  // ── 身份 ──
  readonly runId: string;
  readonly messageId: string;

  // ── 配置快照 ──
  readonly config: EffectiveConfig;

  // ── 取消控制 ──
  private abortController = new AbortController();
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  // ── 内部执行控制 ──
  private seq = 0;
  private _terminated = false;

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
    super();
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
  // 执行入口
  // ════════════════════════════════════════

  async execute(): Promise<void> {
    this.enrichAndEmit({ type: 'start' });
    try {
      for await (const _ of this.agent.call(this)) {
        if (this.signal.aborted) break;
      }
      if (!this._terminated) {
        this.emitContextUsage();
        this.doComplete();
      }
    } catch (err) {
      if (this.signal.aborted) return;
      this.doFail((err as Error)?.message || String(err));
    }
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
   * 保持 AsyncGenerator 签名以兼容 Agent 的 yield* 语法。
   * ToolCall 实例仅在方法作用域内存在，不累积。
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

    yield* toolCall.execute(this);

    return toolCall.observation;
  }

  // ════════════════════════════════════════
  // 生命周期方法 — emit 并返回（兼容 Agent yield）
  // ════════════════════════════════════════

  appendContent(chunk: string): EnrichedEvent {
    return this.enrichAndEmit({ type: 'text_chunk', content: chunk });
  }

  recordThought(content: string): EnrichedEvent {
    return this.enrichAndEmit({ type: 'thought', content });
  }

  /** 供 ToolCall 内部调用 */
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
    if (this._terminated) throw new RunAlreadyCompletedError(this.runId);
    return this.doComplete();
  }

  cancel(reason: string): void {
    if (this._terminated) return;
    this._terminated = true;
    this.abortController.abort(reason);
    this.enrichAndEmit({ type: 'cancelled', reason });
  }

  fail(error: string): EnrichedEvent {
    if (this._terminated) throw new RunAlreadyCompletedError(this.runId);
    return this.doFail(error);
  }

  get isTerminated(): boolean {
    return this._terminated;
  }

  // ── 内部 ──

  private emitContextUsage(): void {
    const { used, total } = this.getContextUsage();
    this.enrichAndEmit({
      type: 'context_usage',
      used,
      total,
      reason: 'turn_completed',
    });
  }

  private doComplete(): EnrichedEvent {
    this._terminated = true;
    return this.enrichAndEmit({ type: 'final' });
  }

  private doFail(error: string): EnrichedEvent {
    this._terminated = true;
    return this.enrichAndEmit({ type: 'error', error });
  }

  private enrichAndEmit(event: any): EnrichedEvent {
    const enriched: EnrichedEvent = {
      ...event,
      runId: this.runId,
      seq: ++this.seq,
      at: Date.now(),
    };
    this.emit('run:event', enriched);
    return enriched;
  }
}
