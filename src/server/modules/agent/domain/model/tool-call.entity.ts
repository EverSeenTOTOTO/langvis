import type { RunEvent } from '@/shared/types/events';
import type { CachePort } from '../port/cache.port';
import type { LlmPort } from '../port/llm.port';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';

/**
 * ToolCall — 工具执行上下文（聚合内实体）。
 *
 * 封装一次工具调用的完整业务流程：输入解析 → 执行 → 输出压缩 → 格式化。
 * yield 原始 RunEvent（tool_call/tool_progress/tool_result/tool_error），
 * 由 AgentRunExecutor 统一 append + 富化 —— 与 agent 一致，事实与传输分离。
 */
export interface ToolCallDeps {
  signal: AbortSignal;
  workDir: string;
  runId: string;
  llm: LlmPort;
  cache: CachePort;
  /** 工具执行元数据：极少数工具（AskUser）用它做 Redis key 关联。
   *  不进入 AgentRunContext / AgentRun，仅由 executeTool 闭包注入。 */
  messageId: string;
}

export class ToolCall extends Entity<string> {
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly startedAt: number;

  input: Record<string, unknown> = {};

  get signal(): AbortSignal {
    return this.deps.signal;
  }
  get workDir(): string {
    return this.deps.workDir;
  }
  get runId(): string {
    return this.deps.runId;
  }
  get messageId(): string {
    return this.deps.messageId;
  }
  get llm(): LlmPort {
    return this.deps.llm;
  }

  #status: 'pending' | 'completed' | 'failed' = 'pending';
  #output?: unknown;
  #error?: string;
  #completedAt?: number;

  private readonly deps: ToolCallDeps;
  private readonly tool: Tool;
  private readonly cache: CachePort;

  constructor(
    callId: string,
    tool: Tool,
    toolArgs: Record<string, unknown>,
    cache: CachePort,
    deps: ToolCallDeps,
  ) {
    super(callId);
    this.toolName = tool.id;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.cache = cache;
    this.deps = deps;
    this.startedAt = Date.now();
  }

  /** 进度事件（瞬时）—— yield 原始 RunEvent */
  emitProgress(data: unknown): RunEvent {
    return { type: 'tool_progress', callId: this.id, data };
  }

  async *execute(): AsyncGenerator<RunEvent, string, void> {
    this.input = (await this.cache.resolve(
      this.runId,
      this.toolArgs,
    )) as Record<string, unknown>;

    yield {
      type: 'tool_call',
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.input,
    };

    try {
      const output = yield* this.tool.call(this);

      const compressed = await this.cache.compress(
        this.runId,
        output,
        this.tool.config?.compression as 'skip' | 'file' | undefined,
      );

      this.doComplete(compressed);
      yield {
        type: 'tool_result',
        callId: this.id,
        toolName: this.toolName,
        output: compressed,
      };
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      this.doFail(errMsg);
      yield {
        type: 'tool_error',
        callId: this.id,
        toolName: this.toolName,
        error: errMsg,
      };
    }

    return this.observation;
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
}
