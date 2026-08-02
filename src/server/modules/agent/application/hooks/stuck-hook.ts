import { ToolIds } from '@/shared/constants';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import {
  StopLoop,
  type Hook,
  type HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { responseUser } from './cumulative-budget-hook';

const STUCK_MESSAGE =
  'I seem to be stuck repeating the same step without making progress. Stopping here — please rephrase or give me more to go on.';

// 卡死兜底：比对 pre-action 动作签名（tool+input）与已见集，新签名清零 streak，重复则 ++，达 guard.stuckThreshold 判卡死。
// pre-action 在 response_user 终态 tick 也跑，先放行；parse 失败不进此相位（loop 兜底）。
@agentHook
export class StuckHook implements Hook {
  readonly id = 'stuck';
  readonly phase: HookPhase = 'pre-action';
  private readonly logger = Logger.child({ source: 'StuckHook' });
  private readonly seen = new Set<string>();
  private streak = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return;

    const action = ctx.pendingAction;
    if (!action || action.tool === ToolIds.RESPONSE_USER) return;
    const sig = `${action.tool}:${JSON.stringify(action.input)}`;

    if (this.seen.has(sig)) this.streak++;
    else {
      this.seen.add(sig);
      this.streak = 0;
    }
    if (this.streak < guard.stuckThreshold) return;

    this.logger.warn(
      `stuck (run ${ctx.runId}): ${this.streak} consecutive no-progress ticks (last sig=${sig})`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `stuck: ${this.streak} consecutive no-progress ticks`,
    };
    yield* responseUser(ctx, STUCK_MESSAGE);
    throw new StopLoop();
  }
}
