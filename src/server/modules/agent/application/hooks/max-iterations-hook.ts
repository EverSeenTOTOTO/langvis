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

const ITER_CAP_MESSAGE =
  'This turn reached its iteration limit without finishing. Stopping here — please continue in a new turn if needed.';

// 迭代上限兜底（length 闸）。阈值取自 guard.maxIterations（生产默认 1000，eval 调小）。
@agentHook
export class MaxIterationsHook implements Hook {
  readonly id = 'max-iterations';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'MaxIterationsHook' });
  private ticks = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard)
      return this.logger.debug(`skip (run ${ctx.runId}): guard config off`);
    this.ticks++;
    if (this.ticks < guard.maxIterations)
      return this.logger.debug(
        `skip (run ${ctx.runId}): tick ${this.ticks} < cap ${guard.maxIterations}`,
      );

    this.logger.warn(
      `iteration cap reached (run ${ctx.runId}): ${this.ticks} >= ${guard.maxIterations}`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `iteration cap reached (${this.ticks} ticks)`,
    };
    yield* responseUser(ctx, ITER_CAP_MESSAGE);
    throw new StopLoop();
  }
}
