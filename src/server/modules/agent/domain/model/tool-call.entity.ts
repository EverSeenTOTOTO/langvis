import type { RunEvent } from '@/shared/types/events';
import type { CachePort } from '../port/cache.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { ToolCallContext } from '../port/tool-call-context.port';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';

/**
 * ToolCall — 一次工具调用的完整业务流程（聚合内实体）。
 */
export interface ToolCallDeps {
  signal: AbortSignal;
  workDir: string;
  runId: string;
  interactive: boolean;
  llm: LlmPort;
  cache: CachePort;
  chatModelId: string | undefined;
  runtimeConfig: Record<string, unknown>;
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

  async *execute(): AsyncGenerator<RunEvent, string, void> {
    this.input = (await this.cache.resolve(
      this.workDir,
      this.toolArgs,
    )) as Record<string, unknown>;

    yield {
      type: 'tool_call',
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.input,
    };

    try {
      const ctx: ToolCallContext = {
        callId: this.id,
        input: this.input,
        signal: this.deps.signal,
        workDir: this.deps.workDir,
        llm: this.deps.llm,
        chatModelId: this.deps.chatModelId,
        runId: this.deps.runId,
        interactive: this.deps.interactive,
        runtimeConfig: this.deps.runtimeConfig,
      };
      const output = yield* this.tool.call(ctx);

      const compressed = await this.cache.compress(
        this.workDir,
        output,
        this.tool.config?.compression as 'skip' | 'file' | undefined,
      );

      this.complete(compressed);
      yield {
        type: 'tool_result',
        callId: this.id,
        toolName: this.toolName,
        output: compressed,
      };
    } catch (error) {
      const errMsg = (error as Error)?.message ?? String(error);
      this.fail(errMsg);
      yield {
        type: 'tool_error',
        callId: this.id,
        toolName: this.toolName,
        error: errMsg,
      };
    }

    return this.observation;
  }

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

  private complete(output: unknown): void {
    this.#status = 'completed';
    this.#output = output;
    this.#completedAt = Date.now();
  }

  private fail(error: string): void {
    this.#status = 'failed';
    this.#error = error;
    this.#completedAt = Date.now();
  }
}
