import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import {
  StopLoop,
  type Hook,
  type HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';
import { serializeAction } from '@/server/modules/agent/application/service/react-loop';
import { agentHook } from './registry';

const budgetMessage = (used: number, budget: number) =>
  `This turn exceeded its token budget (≈${used} / ${budget}). Stopping here — please rephrase or continue in a new turn.`;

// 累计 token 用量兜底（cost 闸）。阈值 guard.maxTokenUsage；pendingAction 由 loop 解析，此处直读。
@agentHook
export class CumulativeBudgetHook implements Hook {
  readonly id = 'cumulative-budget';
  readonly phase: HookPhase = 'pre-action';
  private readonly logger = Logger.child({ source: 'CumulativeBudgetHook' });
  private consumed = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard)
      return this.logger.debug(`skip (run ${ctx.runId}): guard config off`);
    const budget = guard.maxTokenUsage;
    this.consumed += estimateTokens(ctx.messages);
    if (this.consumed <= budget)
      return this.logger.debug(
        `skip (run ${ctx.runId}): consumed ${this.consumed} <= budget ${budget}`,
      );

    if (ctx.pendingAction?.tool === ToolIds.RESPONSE_USER) {
      this.logger.info(
        `cumulative budget exceeded but model answered (run ${ctx.runId}): consumed=${this.consumed}; letting through`,
      );
      return;
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
    throw new StopLoop();
  }
}

/** 复刻 response_user 工具的可观测效果：yield text_chunk + append 一条 response_user ReAct XML。 */
export async function* responseUser(
  ctx: AgentRunContext,
  message: string,
): AsyncGenerator<RunEvent, void> {
  yield { type: 'text_chunk', content: message };
  ctx.messages.push({
    role: Role.ASSIST,
    content: serializeAction({
      tool: ToolIds.RESPONSE_USER,
      input: { message },
    }),
  });
}
