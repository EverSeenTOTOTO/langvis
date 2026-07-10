import { singleton } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

@singleton()
@agentHook
export class LoopUsageHook implements Hook {
  readonly id = 'loop-usage';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'LoopUsageHook' });

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent> {
    const used = estimateTokens(ctx.messages.toArray());
    const total = ctx.config.contextSize;
    this.logger.debug(
      `loop_usage (run ${ctx.runId}): used=${used} total=${total}`,
    );
    yield { type: 'loop_usage', used, total };
  }
}
