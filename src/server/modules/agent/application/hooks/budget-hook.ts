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
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const budgetMessage = (used: number, budget: number) =>
  `This turn exceeded its token budget (≈${used} / ${budget}). Stopping here — please rephrase or continue in a new turn.`;

/**
 * 累计 token 用量兜底（cost 闸）。阈值取自 guard.maxTokenUsage（默认 1M，eval 调小）。
 * 与 QueryBudgetHook（单次 query 体积口径）对照：本 hook 是**累计**口径——每次 post-llm 把
 * "本 tick 的 input+output 估算"（此刻全量 messages）累加进实例字段 consumed。这是已花费成本：
 * 压缩只缩后续前缀、不抵消历史花费，故用累加而非当前上下文大小。
 * 超额时若模型已正当 response_user 则放行（不覆盖收尾），否则发 hook 事件 + 强制答复并 break。
 *
 * 状态内聚在实例字段而非 ctx：hook 为 per-run 实例（见 registry），consumed 天然随 run 生灭，
 * 不污染 ctx、且杜绝跨 run 共享可变字段的并发污染。
 */
@agentHook
export class CumulativeBudgetHook implements Hook {
  readonly id = 'cumulative-budget';
  readonly phase: HookPhase = 'post-llm';
  private readonly logger = Logger.child({ source: 'CumulativeBudgetHook' });
  private consumed = 0;

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return 'next';
    const budget = guard.maxTokenUsage;
    this.consumed += estimateTokens(ctx.messages.toArray());
    if (this.consumed <= budget) return 'next';

    const last = ctx.messages.get(ctx.messages.length - 1);
    if (last?.content) {
      try {
        if (parseResponse(last.content).tool === ToolIds.RESPONSE_USER) {
          this.logger.info(
            `cumulative budget exceeded but model answered (run ${ctx.runId}): consumed=${this.consumed}; letting through`,
          );
          return 'next';
        }
      } catch {
        /* 非 JSON——按未直接答复处理 */
      }
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
