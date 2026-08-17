import { inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { fold, PROCESS_SUMMARY_PROMPT } from '@/server/libs/compaction';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

/** loop 内压缩：折叠 turn 动作轨迹为过程摘要（仅记工作，不复述最终答案） */
@agentHook
export class CompactionHook implements Hook {
  readonly id = 'compaction';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'CompactionHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const compaction = ctx.config.runtimeConfig.loop;
    if (!compaction)
      return this.logger.debug(`skip (run ${ctx.runId}): loop compaction off`);
    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize)
      return this.logger.debug(
        `skip (run ${ctx.runId}): contextSize unresolved`,
      );

    const list = ctx.messages;
    const base = ctx.base;
    const loopActions = list.slice(base);
    if (loopActions.length <= compaction.keepRecent)
      return this.logger.debug(
        `skip (run ${ctx.runId}): loop actions ${loopActions.length} <= keepRecent ${compaction.keepRecent}`,
      );

    const beforeTokens = estimateTokens(list);
    if (beforeTokens <= contextSize * compaction.threshold)
      return this.logger.debug(
        `skip (run ${ctx.runId}): tokens ${beforeTokens} <= ${Math.round(contextSize * compaction.threshold)} (window×threshold)`,
      );

    const keep = compaction.keepRecent;
    const recent = loopActions.slice(-keep);
    const older = loopActions.slice(0, -keep);

    try {
      const recap = await fold({
        messages: older,
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: PROCESS_SUMMARY_PROMPT,
        modelId:
          compaction.compactModelId ?? ctx.config.runtimeConfig.model?.modelId,
      });
      if (!recap) {
        this.logger.warn(
          `fold returned no recap (run ${ctx.runId}): older=${older.length} msgs left uncompacted`,
        );
        return;
      }

      ctx.messages = [
        ...list.slice(0, base),
        {
          role: 'user',
          content: `Observation: [earlier steps in this turn — summarized]\n${recap}`,
        },
        ...recent,
      ];

      const afterTokens = estimateTokens(ctx.messages);
      this.logger.info(
        `compacted (run ${ctx.runId}): ${list.length}→${ctx.messages.length} msgs, ${beforeTokens}→${afterTokens} tokens`,
      );

      yield {
        type: 'hook',
        hookId: this.id,
        summary: 'compacted turn history',
        data: {
          usage: {
            used: afterTokens,
            total: contextSize,
          },
        },
      };
    } catch (err) {
      this.logger.warn(
        `Iteration compaction failed: ${(err as Error)?.message ?? err}`,
      );
    }
    return;
  }
}
