import type { ToolCallRecord } from '@/shared/types/render';
import type { CachePort } from '@/server/modules/memory/ports/cache.port';
import type { EnrichedEvent } from './agent.types';

export type ToolProgress = { type: 'tool_progress'; data: unknown };

/**
 * ToolCall — 聚合内实体。
 * 封装一次工具调用的完整业务流程：输入解析 → 执行 → 输出压缩 → 格式化。
 *
 * 手动迭代 tool.call() 以拦截 tool_progress yield，
 * 通过 run.emitToolProgress() 注入 runId/callId/seq/at。
 */
export class ToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly startedAt: number;

  private tool: {
    call: (
      input: unknown,
      ctx: { signal: AbortSignal },
    ) => AsyncGenerator<ToolProgress, unknown, void>;
    readonly id: string;
    readonly config?: { compression?: string; untrustedOutput?: boolean };
  };
  private cachePort: CachePort;

  private _status: 'pending' | 'completed' | 'failed' = 'pending';
  private _output?: unknown;
  private _error?: string;
  private _completedAt?: number;

  constructor(
    callId: string,
    tool: ToolCall['tool'],
    toolArgs: Record<string, unknown>,
    cachePort: CachePort,
  ) {
    this.callId = callId;
    this.toolName = tool.id;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.cachePort = cachePort;
    this.startedAt = Date.now();
  }

  /**
   * 完整的工具调用生命周期。
   * 通过 run.emitXxx() 发射事件，事件通过 yield 透传到 Agent → 应用层。
   */
  async *execute(run: {
    runId: string;
    signal: AbortSignal;
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
  }): AsyncGenerator<EnrichedEvent, void, void> {
    const resolvedInput = await this.cachePort.resolve(
      run.runId,
      this.toolArgs,
    );

    yield run.emitToolCall(this.callId, this.toolName, resolvedInput);

    try {
      const gen = this.tool.call(resolvedInput, { signal: run.signal });
      let result = await gen.next();

      while (!result.done) {
        if (
          result.value &&
          typeof result.value === 'object' &&
          'type' in result.value &&
          result.value.type === 'tool_progress'
        ) {
          yield run.emitToolProgress(this.callId, result.value.data);
        }
        result = await gen.next();
      }

      const output = result.value;
      const compressed = await this.cachePort.compress(
        run.runId,
        output,
        this.tool.config?.compression as 'skip' | 'file' | undefined,
      );

      this.complete(compressed);
      yield run.emitToolResult(this.callId, this.toolName, compressed);
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      this.fail(errMsg);
      yield run.emitToolError(this.callId, this.toolName, errMsg);
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
      callId: this.callId,
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
