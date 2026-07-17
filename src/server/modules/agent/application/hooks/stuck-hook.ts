import { ToolIds } from '@/shared/constants';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { responseUser } from './cumulative-budget-hook';

const STUCK_MESSAGE =
  'I seem to be stuck repeating the same step without making progress. Stopping here — please rephrase or give me more to go on.';

/**
 * 卡死兜底（liveness 闸）。阈值取自 guard.stuckThreshold（默认 5）。
 * 每次 post-llm 取模型刚吐出的动作签名（tool+input），与本 run 已见签名集比对：
 * 新签名 → 清零 streak；重复签名或解析失败 → streak++。连续无新动作到阈值即判卡死，
 * 发 hook 事件 + 强制答复并 break。
 *
 * post-llm 在 response_user 终态 tick 也会跑（见 react-loop），故先放行 response_user。
 * 解析失败按"无有效动作"处理（streak++），与 eval 旧内联逻辑一致。
 */
@agentHook
export class StuckHook implements Hook {
  readonly id = 'stuck';
  readonly phase: HookPhase = 'post-llm';
  private readonly logger = Logger.child({ source: 'StuckHook' });
  private readonly seen = new Set<string>();
  private streak = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return 'next';

    const last = ctx.messages.get(ctx.messages.length - 1);
    let sig: string;
    try {
      const { tool, input } = parseResponse(last?.content ?? '');
      if (tool === ToolIds.RESPONSE_USER) return 'next';
      sig = `${tool}:${JSON.stringify(input)}`;
    } catch {
      sig = '<parse-fail>';
    }

    if (this.seen.has(sig)) this.streak++;
    else {
      this.seen.add(sig);
      this.streak = 0;
    }
    if (this.streak < guard.stuckThreshold) return 'next';

    this.logger.warn(
      `stuck (run ${ctx.runId}): ${this.streak} consecutive no-progress ticks (last sig=${sig})`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `stuck: ${this.streak} consecutive no-progress ticks`,
    };
    yield* responseUser(ctx, STUCK_MESSAGE);
    return 'break';
  }
}
