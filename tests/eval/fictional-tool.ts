// 虚构工具基类：隐藏 runId→沙箱 取回，域工具只实现 run(backend, input, ctx)；其余由 registerTool 注入。
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
    const backend = getSandbox<B>(ctx.run.runId);
    return yield* this.run(backend, ctx.input, ctx);
  }
}
