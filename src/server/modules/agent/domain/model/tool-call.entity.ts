import type { RunEvent } from '@/shared/types/events';
import type {
  AgentRunContext,
  ToolRunResult,
} from '../port/agent-run-context.port';
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
    return this.ctx.run.runId;
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

  async *execute(): AsyncGenerator<RunEvent, ToolRunResult, void> {
    // 工具入参即 LLM 产出的 JSON原样直用；大输出经 OutputOffloadHook 桩化落盘，不自动解析回对象。
    this.input = this.toolArgs;

    yield {
      type: 'tool_call',
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.input,
    };

    try {
      // 入参校验在 @tool 装饰器包好的 call 内完成（校验 + 替换 ctx.input），此处仅编排。
      const callCtx: ToolCallContext = {
        callId: this.id,
        input: this.input,
        signal: this.ctx.signal,
        workDir: this.ctx.workDir,
        conversationId: this.ctx.conversationId,
        llm: this.ctx.llm,
        auth: this.ctx.auth,
        run: this.ctx.run,
        interactive: this.ctx.interactive,
        runtimeConfig: this.ctx.config.runtimeConfig,
      };
      const output = yield* this.tool.call(callCtx);

      // #output 留全文：tool_result 事件/DB/前端/历史回放都看全文（事件真相）。
      // 给 LLM 看的 messages 由 post-observation OutputOffloadHook 按大小桩化（产出即桩，无损落盘）。
      this.complete(output);
      yield {
        type: 'tool_result',
        callId: this.id,
        toolName: this.toolName,
        output,
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

    return { observation: this.observation, status: this.status };
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
