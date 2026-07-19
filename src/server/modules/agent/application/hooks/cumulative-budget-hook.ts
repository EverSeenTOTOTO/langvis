import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const budgetMessage = (used: number, budget: number) =>
  `This turn exceeded its token budget (≈${used} / ${budget}). Stopping here — please rephrase or continue in a new turn.`;

/**
 * 累计 token 用量兜底（cost 闸）。阈值取自 guard.maxTokenUsage（默认 1M，eval 调小）。
 * 本 tick 的动作由 loop 权威解析后挂在 ctx.pendingAction，此处直读、不再 re-parse。
 */
@agentHook
export class CumulativeBudgetHook implements Hook {
  readonly id = 'cumulative-budget';
  readonly phase: HookPhase = 'pre-action';
  private readonly logger = Logger.child({ source: 'CumulativeBudgetHook' });
  private consumed = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return 'next';
    const budget = guard.maxTokenUsage;
    this.consumed += estimateTokens(ctx.messages.toArray());
    if (this.consumed <= budget) return 'next';

    if (ctx.pendingAction?.tool === ToolIds.RESPONSE_USER) {
      this.logger.info(
        `cumulative budget exceeded but model answered (run ${ctx.runId}): consumed=${this.consumed}; letting through`,
      );
      return 'next';
    }

    this.logger.warn(
      `cumulative budget exceeded (run ${ctx.runId}): consumed=${this.consumed} > ${budget}; responding and breaking`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `cumulative budget exceeded (consumed=${this.consumed} > ${budget})`,
    };
    yield* responseUser(ctx, budgetMessage(this.consumed, budget));
    return 'break';
  }
}

/** 复刻 response_user 工具的可观测效果：yield text_chunk + append 一条 response_user ReAct JSON。 */
export async function* responseUser(
  ctx: AgentRunContext,
  message: string,
): AsyncGenerator<RunEvent, void> {
  yield { type: 'text_chunk', content: message };
  ctx.messages = ctx.messages.append({
    role: Role.ASSIST,
    content: JSON.stringify({
      tool: ToolIds.RESPONSE_USER,
      input: { message },
    }),
  });
}
