import { singleton, inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { LoopCompactionConfig } from '@/server/modules/agent/domain/model/loop-config.fragment';
import type { RunEvent } from '@/shared/types/events';
import { PROCESS_SUMMARY_PROMPT } from './prompts';
import { fold } from '@/server/libs/compaction';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

@singleton()
@agentHook
export class CompactionHook implements Hook {
  readonly id = 'compaction';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'CompactionHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent> {
    const compaction = (
      ctx.config.runtimeConfig as { loop: LoopCompactionConfig }
    ).loop;
    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize) return;

    const list = ctx.messages;
    const base = ctx.base;
    const loopActions = list.drop(base);
    if (loopActions.length <= compaction.keepRecent) return;

    const beforeTokens = estimateTokens(list.toArray());
    if (beforeTokens <= contextSize * compaction.threshold) return;

    const recent = loopActions.takeLast(compaction.keepRecent);
    const older = loopActions.dropLast(compaction.keepRecent);

    try {
      const recap = await fold({
        messages: older.toArray(),
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
      if (!recap) return;

      ctx.messages = list
        .take(base)
        .append({
          role: 'user',
          content: `Observation: [earlier steps in this turn — summarized]\n${recap}`,
        })
        .concat(recent);

      const afterTokens = estimateTokens(ctx.messages.toArray());
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
  }
}
