import type { ToolCallRecord } from '@/shared/types/render';
import type { CachePort } from '../port/cache.port';
import type { EnrichedEvent } from '@/shared/types/events';
import type { LlmPort } from '../port/llm.port';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';
import type { AgentRun } from './agent-run.entity';

/**
 * ToolCall — 聚合内实体。
 * 封装一次工具调用的完整业务流程：输入解析 → 执行 → 输出压缩 → 格式化。
 *
 * 持有 aggregate root (AgentRun) 引用，emit 方法委托到 root。
 * 通过 tool.call(this) 传给 Tool — 对称 agent.call(run)。
 */
export class ToolCall extends Entity<string> {
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly startedAt: number;

  input: Record<string, unknown> = {};

  // ── Aggregate root 代理 ──
  private readonly run: AgentRun;

  get signal(): AbortSignal {
    return this.run.signal;
  }
  get workDir(): string {
    return this.run.workDir;
  }
  get messageId(): string {
    return this.run.messageId;
  }
  get runId(): string {
    return this.run.runId;
  }
  get llm(): LlmPort {
    return this.run.llm;
  }

  // ── 状态 ──
  #status: 'pending' | 'completed' | 'failed' = 'pending';
  #output?: unknown;
  #error?: string;
  #completedAt?: number;

  private tool: Tool;
  private cache: CachePort;

  constructor(
    callId: string,
    tool: Tool,
    toolArgs: Record<string, unknown>,
    cache: CachePort,
    run: AgentRun,
  ) {
    super(callId);
    this.toolName = tool.id;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.cache = cache;
    this.run = run;
    this.startedAt = Date.now();
  }

  // ════════════════════════════════════════
  // Emit 委托 — 通过 aggregate root 发布
  // ════════════════════════════════════════

  emitCall(): EnrichedEvent {
    return this.run.emitToolCall(this.id, this.toolName, this.input);
  }

  emitProgress(data: unknown): EnrichedEvent {
    return this.run.emitToolProgress(this.id, data);
  }

  emitResult(output: unknown): EnrichedEvent {
    return this.run.emitToolResult(this.id, this.toolName, output);
  }

  emitError(error: string): EnrichedEvent {
    return this.run.emitToolError(this.id, this.toolName, error);
  }

  // ════════════════════════════════════════
  // 完整的工具调用生命周期
  // ════════════════════════════════════════

  async *execute(): AsyncGenerator<EnrichedEvent, void, void> {
    this.input = (await this.cache.resolve(
      this.runId,
      this.toolArgs,
    )) as Record<string, unknown>;

    yield this.emitCall();

    try {
      const output = yield* this.tool.call(this);

      const compressed = await this.cache.compress(
        this.runId,
        output,
        this.tool.config?.compression as 'skip' | 'file' | undefined,
      );

      this.doComplete(compressed);
      yield this.emitResult(compressed);
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      this.doFail(errMsg);
      yield this.emitError(errMsg);
    }
  }

  /** 业务规则：不可信输出包装 */
  get observation(): string {
    if (this.#status === 'failed') {
      return `Error executing tool "${this.toolName}": ${this.#error}`;
    }
    const raw =
      typeof this.#output === 'string'
        ? this.#output
        : JSON.stringify(this.#output);
    return this.tool.config?.untrustedOutput
      ? `<untrusted_content>\n${raw}\n</untrusted_content>`
      : raw;
  }

  get duration(): number {
    return (this.#completedAt ?? Date.now()) - this.startedAt;
  }

  get status(): 'pending' | 'completed' | 'failed' {
    return this.#status;
  }

  private doComplete(output: unknown): void {
    this.#status = 'completed';
    this.#output = output;
    this.#completedAt = Date.now();
  }

  private doFail(error: string): void {
    this.#status = 'failed';
    this.#error = error;
    this.#completedAt = Date.now();
  }

  toRecord(): ToolCallRecord {
    return {
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.toolArgs,
      status: this.#status as 'completed' | 'failed',
      output: this.#output,
      error: this.#error,
      duration: this.duration,
      startedAt: this.startedAt,
      completedAt: this.#completedAt!,
    };
  }
}
