import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { responseUser } from './budget-hook';

const ITER_CAP_MESSAGE =
  'This turn reached its iteration limit without finishing. Stopping here — please continue in a new turn if needed.';

/**
 * 迭代上限兜底（length 闸）。阈值取自 guard.maxIterations（生产默认 1000，eval 调小）。
 * 每次 post-observation 自增实例计数 ticks（post-observation 每 tick 跑一次、终态 tick 不跑），
 * 到上限即发 hook 事件 + 强制答复并 break。
 *
 * 与 StuckHook 互补：StuckHook 抓"原地空转"（每 tick 便宜但无限），
 * MaxIterationsHook 抓"稳步推进但过长"（合法但超预算）。
 */
@agentHook
export class MaxIterationsHook implements Hook {
  readonly id = 'max-iterations';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'MaxIterationsHook' });
  private ticks = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return 'next';
    this.ticks++;
    if (this.ticks < guard.maxIterations) return 'next';

    this.logger.warn(
      `iteration cap reached (run ${ctx.runId}): ${this.ticks} >= ${guard.maxIterations}`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `iteration cap reached (${this.ticks} ticks)`,
    };
    yield* responseUser(ctx, ITER_CAP_MESSAGE);
    return 'break';
  }
}
