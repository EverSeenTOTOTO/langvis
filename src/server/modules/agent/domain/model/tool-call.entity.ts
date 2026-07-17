import type { RunEvent } from '@/shared/types/events';
import type { AgentRunContext } from '../port/agent-run-context.port';
import type { ToolCallContext } from '../port/tool-call-context.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { Entity } from '@/server/libs/ddd';
import type { Tool } from './tool.base';
import { validate } from '@/server/utils/schemaValidator';

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
    // 工具入参即 LLM 产出的 JSON，原样直用——不存在自动 resolve。
    // 大工具输出经 post-observation offload-hook 落盘桩化（见 observation 注释），
    // 落盘件只供 cached_read/rg 检索，不会被自动解析回对象。
    this.input = this.toolArgs;

    yield {
      type: 'tool_call',
      callId: this.id,
      toolName: this.toolName,
      toolArgs: this.input,
    };

    try {
      this.validateInput();
      const callCtx: ToolCallContext = {
        callId: this.id,
        input: this.input,
        signal: this.ctx.signal,
        workDir: this.ctx.workDir,
        llm: this.ctx.llm,
        auth: this.ctx.auth,
        runId: this.ctx.runId,
        interactive: this.ctx.interactive,
        runtimeConfig: this.ctx.config.runtimeConfig,
      };
      const output = yield* this.tool.call(callCtx);

      // #output 留全文：tool_result 事件/DB/前端/历史回放都看全文（事件真相）。
      // 给 LLM 看的 messages 由 post-observation offload-hook 预算化桩化（无损落盘）。
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

  /** 校验 inputSchema：缺 required/类型不符抛错，被 execute catch 转成 tool_error 回馈模型。 */
  private validateInput(): void {
    const schema = this.tool.config?.inputSchema;
    if (!schema) return;
    const result = validate<Record<string, unknown>>(schema, this.input);
    if (!result.valid) {
      throw new Error(
        `Invalid input for tool "${this.tool.id}": ${result.errors}`,
      );
    }
    this.input = result.data;
  }
}
