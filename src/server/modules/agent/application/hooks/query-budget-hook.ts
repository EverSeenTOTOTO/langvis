import { Inject } from '@nestjs/common';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import {
  StopLoop,
  type Hook,
  type HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { responseUser } from '../service/react-message';

/** 不可恢复超窗时向用户解释的消息（与兄弟 stop hook 的文案风格一致）。 */
const overflowMessage = (reason: string) =>
  `This reply couldn't be produced: ${reason}. Start a new session, lower the conversation compaction threshold, or use a larger-context model.`;

// 整体上下文 fail-fast（pre-LLM）：只以整体上下文为视角，不做单条 query 体积限制 / 截断 / 收窄。
// 裁剪与微压缩已先跑；若全量仍超窗 → 无可恢复（再 drop 任何单条也无济于事）→ 先解释再 StopLoop。
export class QueryBudgetHook implements Hook {
  readonly id = 'query-budget';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'QueryBudgetHook' });

  constructor(
    @Inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard)
      return this.logger.debug(`skip (run ${ctx.runId}): guard config off`);
    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize)
      return this.logger.debug(
        `skip (run ${ctx.runId}): contextSize unresolved`,
      );

    const messages = ctx.messages;
    const last = messages.length - 1;
    if (last < 0)
      return this.logger.debug(`skip (run ${ctx.runId}): no messages`);

    const used = estimateTokens(messages);
    if (used <= contextSize)
      return this.logger.debug(
        `skip (run ${ctx.runId}): ${used} <= window ${contextSize}`,
      );

    // 全量超窗：最新一条落在 seed 内（last<base）则 seed 自身过大；否则整体仍装不下。
    const reason =
      last < ctx.base
        ? "the conversation seed already fills the model's context window"
        : "the conversation already fills the model's context window";
    this.logger.error(
      `unrecoverable overflow (run ${ctx.runId}): ${used} > ${contextSize} (${reason})`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: 'unrecoverable overflow (context fills window)',
      data: { usage: { used, total: contextSize } },
    };
    // 与兄弟 stop hook 一致：先发一条可见的解释消息再终止，避免前端只见空消息。
    yield* responseUser(ctx, overflowMessage(reason));
    throw new StopLoop();
  }
}
