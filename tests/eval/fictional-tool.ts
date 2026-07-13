/**
 * 虚构工具基类：隐藏 runId→沙箱 的取回，域工具只实现 run(backend, input, ctx)。
 * id/config/logger 由 registerTool 的 afterResolution 注入（与真实工具同机制）。
 */
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { getSandbox } from './sandbox-registry';

export abstract class FictionalTool<O, B> extends Tool<O> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  protected abstract run(
    backend: B,
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, O, void>;

  async *call(ctx: ToolCallContext): AsyncGenerator<RunEvent, O, void> {
    const backend = getSandbox<B>(ctx.runId);
    return yield* this.run(backend, ctx.input, ctx);
  }
}
