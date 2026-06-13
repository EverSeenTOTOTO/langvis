import type { ToolCallRecord } from '@/shared/types/render';
import type { CacheService } from '@/server/modules/memory/services/cache.service';
import type { EnrichedEvent } from './agent.types';
import type { Llm } from './llm';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';

export type ToolProgress = { type: 'tool_progress'; data: unknown };

export type ToolCallEmitter = {
  emitToolCall: (
    callId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => EnrichedEvent;
  emitToolProgress: (callId: string, data: unknown) => EnrichedEvent;
  emitToolResult: (
    callId: string,
    toolName: string,
    output: unknown,
  ) => EnrichedEvent;
  emitToolError: (
    callId: string,
    toolName: string,
    error: string,
  ) => EnrichedEvent;
};

/**
 * ToolCall — 聚合内实体。
 * 封装一次工具调用的完整业务流程：输入解析 → 执行 → 输出压缩 → 格式化。
 *
 * 持有完整执行上下文（signal, llm, input, workDir, messageId, runId），
 * 通过 tool.call(this) 传给 Tool — 对称 agent.call(run)。
 */
export class ToolCall extends Entity<string> {
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly startedAt: number;

  readonly signal: AbortSignal;
  readonly workDir: string;
  readonly messageId: string;
  readonly runId: string;
  readonly llm: Llm;

  input: Record<string, unknown> = {};

  private tool: Tool;
  private cache: CacheService;

  private _status: 'pending' | 'completed' | 'failed' = 'pending';
  private _output?: unknown;
  private _error?: string;
  private _completedAt?: number;

  constructor(
    callId: string,
    tool: Tool,
    toolArgs: Record<string, unknown>,
    cache: CacheService,
    signal: AbortSignal,
    workDir: string,
    messageId: string,
    runId: string,
    llm: Llm,
  ) {
    super(callId);
    this.toolName = tool.id;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.cache = cache;
    this.startedAt = Date.now();

    this.signal = signal;
    this.workDir = workDir;
    this.messageId = messageId;
    this.runId = runId;
    this.llm = llm;
  }

  /**
   * 完整的工具调用生命周期。
   * emitter 由 AgentRun 提供 — ToolCall 自身已持有全部执行上下文。
   */
  async *execute(
    emitter: ToolCallEmitter,
  ): AsyncGenerator<EnrichedEvent, void, void> {
    this.input = (await this.cache.resolve(
      this.runId,
      this.toolArgs,
    )) as Record<string, unknown>;

    yield emitter.emitToolCall(this.id, this.toolName, this.input);

    try {
      const gen = this.tool.call(this);
      let result = await gen.next();

      while (!result.done) {
        if (
          result.value &&
          typeof result.value === 'object' &&
          'type' in result.value &&
          result.value.type === 'tool_progress'
        ) {
          yield emitter.emitToolProgress(this.id, result.value.data);
        }
        result = await gen.next();
      }

      const output = result.value;
      const compressed = await this.cache.compress(
        this.runId,
        output,
        this.tool.config?.compression as 'skip' | 'file' | undefined,
      );

      this.complete(compressed);
      yield emitter.emitToolResult(this.id, this.toolName, compressed);
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      this.fail(errMsg);
      yield emitter.emitToolError(this.id, this.toolName, errMsg);
    }
  }

  /** 业务规则：不可信输出包装 */
  get observation(): string {
    if (this._status === 'failed') {
      return `Error executing tool "${this.toolName}": ${this._error}`;
    }
    const raw =
      typeof this._output === 'string'
        ? this._output
        : JSON.stringify(this._output);
    return this.tool.config?.untrustedOutput
      ? `<untrusted_content>\n${raw}\n</untrusted_content>`
      : raw;
  }

  get duration(): number {
    return (this._completedAt ?? Date.now()) - this.startedAt;
  }

  get status(): 'pending' | 'completed' | 'failed' {
    return this._status;
  }

  private complete(output: unknown): void {
    this._status = 'completed';
    this._output = output;
    this._completedAt = Date.now();
  }

  private fail(error: string): void {
    this._status = 'failed';
    this._error = error;
    this._completedAt = Date.now();
  }

  toRecord(): ToolCallRecord {
    return {
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.toolArgs,
      status: this._status as 'completed' | 'failed',
      output: this._output,
      error: this._error,
      duration: this.duration,
      startedAt: this.startedAt,
      completedAt: this._completedAt!,
    };
  }
}
