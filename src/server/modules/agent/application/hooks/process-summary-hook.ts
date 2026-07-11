import { singleton } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { PROCESS_SUMMARY_PROMPT } from './compaction-hook';
import { fold } from '@/server/libs/compaction';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

@singleton()
@agentHook
export class ProcessSummaryHook implements Hook {
  readonly id = 'process-summary';
  readonly phase: HookPhase = 'loop-exit';
  private readonly logger = Logger.child({ source: 'ProcessSummaryHook' });

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const compaction = ctx.config.runtimeConfig.loop;
    if (!compaction) return 'next';
    const loopActions = ctx.messages.drop(ctx.base);
    if (loopActions.length <= 1) {
      this.logger.debug(`trivial turn, skipped (run ${ctx.runId})`);
      return 'next';
    }

    try {
      const summary = await fold({
        messages: loopActions.toArray(),
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
      if (!summary) return 'next';
      ctx.run.processSummary = summary;
      this.logger.info(
        `folded process summary (run ${ctx.runId}): ${loopActions.length} loop actions`,
      );
      yield {
        type: 'hook',
        hookId: this.id,
        summary: 'folded turn process summary',
      };
    } catch (err) {
      this.logger.warn(
        `Process summary failed: ${(err as Error)?.message ?? err}`,
      );
    }
    return 'next';
  }
}
