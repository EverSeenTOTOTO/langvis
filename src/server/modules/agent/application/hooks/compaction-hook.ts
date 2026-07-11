import { singleton, inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { Prompt } from '@/server/libs/prompt';
import { fold } from '@/server/libs/compaction';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

/** 折叠 turn 动作轨迹为过程摘要（仅记工作，不复述最终答案）；ProcessSummaryHook 复用作最终 processSummary。 */
export const PROCESS_SUMMARY_PROMPT = Prompt.empty()
  .with('Role', 'You compact an agent turn into a concise process summary.')
  .with(
    'Instructions',
    'Fold the history below into a concise process summary of the WORK done: tools called and why, what was attempted, difficulties or errors, intermediate results, and key decisions. The history may begin with a previous summary — incorporate it. Capture the trajectory of work only — the final answer is delivered to the user separately and must NOT be restated or paraphrased. Be concise and chronological; do not fabricate.',
  )
  .with('History', '')
  .with(
    'Output',
    'Output only the process summary (no extra explanation, no Markdown headings).',
  );

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
    const compaction = ctx.config.runtimeConfig.loop;
    if (!compaction) return;
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
