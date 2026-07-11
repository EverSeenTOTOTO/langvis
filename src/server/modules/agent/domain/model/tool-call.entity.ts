import type { RunEvent } from '@/shared/types/events';
import type { AgentRunContext } from '../port/agent-run-context.port';
import type { ToolCallContext } from '../port/tool-call-context.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';

/** ToolCall — 一次工具调用的完整业务流程（聚合内实体）。 */
export class ToolCall extends Entity<string> {
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly startedAt: number;

  input: Record<string, unknown> = {};

  get signal(): AbortSignal {
    return this.ctx.signal;
  }
  get workDir(): string {
    return this.ctx.workDir;
  }
  get runId(): string {
    return this.ctx.runId;
  }
  get llm(): LlmPort {
    return this.ctx.llm;
  }

  #status: 'pending' | 'completed' | 'failed' = 'pending';
  #output?: unknown;
  #error?: string;
  #completedAt?: number;

  private readonly ctx: AgentRunContext;
  private readonly tool: Tool;

  constructor(
    callId: string,
    tool: Tool,
    toolArgs: Record<string, unknown>,
    ctx: AgentRunContext,
  ) {
    super(callId);
    this.toolName = tool.id;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.ctx = ctx;
    this.startedAt = Date.now();
  }

  async *execute(): AsyncGenerator<RunEvent, string, void> {
    this.input = (await this.ctx.cache.resolve(
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
      const callCtx: ToolCallContext = {
        callId: this.id,
        input: this.input,
        signal: this.ctx.signal,
        workDir: this.ctx.workDir,
        llm: this.ctx.llm,
        runId: this.ctx.runId,
        interactive: this.ctx.interactive,
        runtimeConfig: this.ctx.config.runtimeConfig,
      };
      const output = yield* this.tool.call(callCtx);

      const compressed = await this.ctx.cache.compress(
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
