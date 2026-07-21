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
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { classifyRecall, type RecallKind } from './offload-recall';

const OBSERVATION_PREFIX = 'Observation: ';
/** 截断保留头部目标比例（留余量吸收 estimateTokens 低估，防截断后仍触窗）。 */
const TRUNCATE_TARGET_RATIO = 0.8;
/** 初始 char-budget：英文 ~4 chars/token 取满；中文由循环按估算裁进目标。 */
const CHARS_PER_TOKEN = 4;

/**
 * 最新消息体积护栏
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
    // per-latest 单条预算 = min(maxQueryTokens, contextWindow×maxQuerySize)。阈值在 guard fragment。
    const budget = Math.min(
      guard.maxQueryTokens!,
      Math.floor(contextSize * guard.maxQuerySize!),
    );

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

    // 超限但可恢复：截断保留前 ~cap token 真实内容 + 收窄指引，放行 LLM（agent 据指引收窄重取，
    // 而非销毁内容只留空泛 note → 9B 不知如何收窄 → 重取大块 → drop 螺旋）。recall（盘上已落盘内容）
    // 指明 rg/sed-n/head-n 收窄；非 recall 指明收窄发起方工具。
    const msg = messages[last]!;
    const raw = msg.content;
    const isObservation = raw.startsWith(OBSERVATION_PREFIX);
    const bodyText = isObservation ? raw.slice(OBSERVATION_PREFIX.length) : raw;
    const recall = classifyRecall(messages, last);
    messages[last] = {
      ...msg,
      content: truncatedObservation(
        bodyText,
        isObservation,
        latestTokens,
        cap,
        recall,
      ),
    };
    ctx.messages = ListMonad.of(messages);
    this.logger.warn(
      `query over budget (run ${ctx.runId}): latest ${latestTokens} > ${cap} cap (prefix ${prefixTokens}, window ${contextSize}); truncated latest + narrowing directive`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: 'query over budget, truncated latest + narrowing directive',
      data: { usage: { used: latestTokens, total: contextSize } },
    };
    return 'next';
  }
}

/** 截断到 cap×TRUNCATE_TARGET_RATIO 内（按 estimateTokens 迭代裁尾），保留真实头部 + 收窄指引。
 *  不调 cache.offload → 不产生新句柄 → 无 fc→fc 别名增殖。 */
function truncatedObservation(
  body: string,
  isObservation: boolean,
  used: number,
  cap: number,
  recall: RecallKind | null,
): string {
  const target = Math.floor(cap * TRUNCATE_TARGET_RATIO);
  let head = body.slice(0, cap * CHARS_PER_TOKEN);
  let est = estimateTokens([{ role: 'user', content: head }]);
  let guard = 0;
  while (est > target && guard < 20) {
    const next = Math.max(64, Math.floor((head.length * target) / est));
    head = head.slice(0, next);
    est = estimateTokens([{ role: 'user', content: head }]);
    guard++;
  }
  const kept = estimateTokens([{ role: 'user', content: head }]);
  const omitted = Math.max(0, used - kept);
  const recallTarget = recall?.type === 'bash' ? recall.file : null;
  const directive = recallTarget
    ? `[query over budget: ~${used} tokens > ~${cap} cap. Above is the truncated head (~${omitted} tokens omitted); the full content remains on disk. Narrow: via the bash tool run rg -n "<keyword>" -C3 ${recallTarget} (tighter pattern / smaller -C) or sed -n "<range>" ${recallTarget} or head -n <N> ${recallTarget}; do NOT re-read the whole file or re-run the same broad search; then continue.]`
    : `[query over budget: ~${used} tokens > ~${cap} cap. Above is the truncated head (~${omitted} tokens omitted). Narrow the originating call (tighter pattern / smaller page range / smaller limit) and re-issue so the result fits, then continue.]`;
  const text = `${head}\n${directive}`;
  return isObservation ? `${OBSERVATION_PREFIX}${text}` : text;
}
