import { inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { ListMonad } from '@/server/libs/list';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { queryTokenCap } from './query-cap';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const OBSERVATION_PREFIX = 'Observation: ';

/**
 * pre-LLM **per-latest** 体积护栏：OffloadHook（无损落盘，总量口径）之后的末道有损防线。
 * 与 OffloadHook 无关——offload 是总量/窗口口径（阈值 offload.windowRatio，offload 最胖历史），
 * 本 hook 是 per-latest 单条口径（阈值 guard.maxQuerySize，drop 最新一条）。两 hook 维度不同、阈值不同。
 *
 * 口径是**最新一条**消息：offload 跳过 read-slice（cached_read 结果带 [read offset= 页脚）以断
 * offload↔read 环，一个胖 cached_read 切片会被原样留在消息里，顶过窗的正是它。故本 hook 测算最新一条
 * 是否塞得进"留给它的余量"：
 *   budget   = min(guard.maxQueryTokens, contextWindow×guard.maxQuerySize)（per-latest 单条预算，默认 0.4/10k）
 *   remaining = contextWindow − estimateTokens(最新一条之前的所有消息)（留给最新一条的可用窗口）
 *   cap      = min(budget, remaining)
 * 最新一条 tokens > cap → 只 drop 它 + 收缩提示 + 'continue'（跳过本次 LLM、重入下一轮）。
 * budget 项管"单条不该独占窗口"（小窗防爆 400、10k 拦病态胖取）；
 * remaining 项管"prefix 已占了大半窗时，最新一条只剩那么多余量"——大 seed + 中等 latest 实际爆窗的兜底。
 *
 * 不可恢复 → break：① 最新一条落在 [0,base) seed 内（last < base，无可 drop）；② prefix 自身 ≥ 窗口
 * （remaining ≤ 0，offload/compaction 未能缩进窗口）。两者发事件 + break，避免 'continue' 死循环。
 */
@agentHook
export class QueryBudgetHook implements Hook {
  readonly id = 'query-budget';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'QueryBudgetHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return 'next';
    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize) return 'next';
    // per-latest 单条预算（guard.maxQuerySize / maxQueryTokens）；与 offload（总量口径）无关。
    const budget = queryTokenCap(contextSize, guard);

    const messages = ctx.messages.toArray();
    const last = messages.length - 1;
    // 留给最新一条的可用窗口 = 窗口 − 最新一条之前已占用的 token。
    const prefixTokens = estimateTokens(messages.slice(0, last));
    const remaining = contextSize - prefixTokens;
    const cap = Math.min(budget, remaining);

    // 最新一条塞得进留给它的余量 → 放行。须先判，否则 seed 末条（last<base）会被误判不可恢复。
    const latestTokens = estimateTokens([messages[last]!]);
    if (latestTokens <= cap) return 'next';

    // 超限但无可 drop：
    // ① 最新一条落在 [0,base) seed 内 → 无可 drop（base 自身超窗）。
    if (last < ctx.base) {
      this.logger.error(
        `unrecoverable overflow (run ${ctx.runId}): latest ${latestTokens} > ${cap} but in seed (base too large)`,
      );
      yield {
        type: 'hook',
        hookId: this.id,
        summary: 'unrecoverable overflow (base too large)',
        data: { usage: { used: latestTokens, total: contextSize } },
      };
      return 'break';
    }
    // ② prefix 自身 ≥ 窗口（remaining ≤ 0）→ offload/compaction 未能缩进窗口，drop 最新无济于事。
    if (remaining <= 0) {
      this.logger.error(
        `unrecoverable overflow (run ${ctx.runId}): prefix ${prefixTokens} ≥ window ${contextSize}`,
      );
      yield {
        type: 'hook',
        hookId: this.id,
        summary: 'unrecoverable overflow (prefix fills window)',
        data: { usage: { used: prefixTokens, total: contextSize } },
      };
      return 'break';
    }

    // drop 最新一条 + 收缩提示，跳过本次 LLM、重入下一轮。
    const msg = messages[last]!;
    messages[last] = {
      ...msg,
      content: overLimitObservation(
        msg.content.startsWith(OBSERVATION_PREFIX),
        latestTokens,
        cap,
      ),
    };
    ctx.messages = ListMonad.of(messages);
    this.logger.warn(
      `query over budget (run ${ctx.runId}): latest ${latestTokens} > ${cap} cap (prefix ${prefixTokens}, window ${contextSize}); dropped latest message`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: 'query over budget, dropped latest message',
      data: { usage: { used: latestTokens, total: contextSize } },
    };
    return 'continue';
  }
}

/** 超限 observation：短，本身不再触窗。告诉 agent 收缩 scope 重取（而非把巨内容塞回模型）。 */
function overLimitObservation(
  isObservation: boolean,
  used: number,
  cap: number,
): string {
  const note =
    `[query over budget: ~${used} tokens > ~${cap} cap. ` +
    `The oversized slice was too large to keep inline and has been dropped. ` +
    `Re-issue the fetch with a smaller scope (smaller limit or narrower page range; ` +
    `or rg an offloaded file to pull only matched lines) so the result fits, then continue.]`;
  return isObservation ? `${OBSERVATION_PREFIX}${note}` : note;
}
