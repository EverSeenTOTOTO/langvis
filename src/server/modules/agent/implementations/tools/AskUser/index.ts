import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';

export interface AskUserInput {
  message: string;
  formSchema: JSONSchemaType<Record<string, any>>;
  timeout?: number;
}

export interface AskUserOutput {
  submitted: boolean;
  data?: Record<string, any>;
}

// HITL：在 ctx.run 的聚合运行期协调态上登记待输入表单并阻塞等待提交。
// 状态在聚合上，由 web 提交端经 executor.getActiveRun 写入；此处只等 Deferred 被 resolve。
@tool(ToolIds.ASK_USER)
export default class AskUserTool extends Tool<AskUserOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  describe(
    input: Record<string, unknown>,
    output?: unknown,
    error?: string,
  ): string {
    const { message } = input as { message?: string };
    if (error)
      return `asked user${message ? `: ${message}` : ''} → failed: ${error}`;
    const submitted = (output as { submitted?: boolean } | undefined)
      ?.submitted;
    return `asked user${message ? `: ${message}` : ''}${submitted ? ' (answered)' : ' (cancelled)'}`;
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, AskUserOutput, void> {
    ctx.signal.throwIfAborted();

    // 非交互式 run（子 agent）无 HTTP 提交入口——直接 fail-fast，避免空等 300s 超时。
    if (!ctx.interactive) {
      throw new Error(
        'HITL unavailable in non-interactive (sub-agent) run; cannot request user input',
      );
    }

    const run = ctx.run;
    const params = ctx.input as unknown as AskUserInput;
    const { message, formSchema, timeout = 300_000 } = params;

    run.beginAwaitInput({ formSchema, message });
    this.logger.info(`AskUser request created for run ${ctx.run.runId}`);

    yield {
      type: 'tool_progress',
      callId: ctx.callId,
      data: {
        status: 'awaiting_input',
        message,
        schema: formSchema,
      },
    };

    const { submitted, result } = await run.waitForInput(timeout, ctx.signal);

    if (ctx.signal.aborted) {
      ctx.signal.throwIfAborted();
    }

    if (submitted) {
      this.logger.info(`AskUser request submitted for run ${ctx.run.runId}`);
      return { submitted: true, data: result };
    }

    this.logger.info(`AskUser request timeout for run ${ctx.run.runId}`);
    return { submitted: false };
  }
}
