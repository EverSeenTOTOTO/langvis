import { inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import {
  StopLoop,
  type Hook,
  type HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { responseUser } from './cumulative-budget-hook';
import {
  classifyRecall,
  type RecallKind,
} from '@/server/modules/agent/domain/offload/offload-recall';

const OBSERVATION_PREFIX = 'Observation: ';
/** 截断保留头部目标比例（留余量吸收 estimateTokens 低估，防截断后仍触窗）。 */
const TRUNCATE_TARGET_RATIO = 0.8;
/** 初始 char-budget：英文 ~4 chars/token 取满；中文由循环按估算裁进目标。 */
const CHARS_PER_TOKEN = 4;

/** 不可恢复超窗时向用户解释的消息（与兄弟 stop hook 的文案风格一致）。 */
const overflowMessage = (reason: string) =>
  `This reply couldn't be produced: the conversation already fills the model's context window (${reason}). Start a new session, lower the conversation compaction threshold, or use a larger-context model.`;

// 最新消息体积护栏
@agentHook
export class QueryBudgetHook implements Hook {
  readonly id = 'query-budget';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'QueryBudgetHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const guard = ctx.config.runtimeConfig.guard;
    if (!guard) return;
    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize) return;
    // per-latest 单条预算 = min(maxQueryTokens, contextWindow×maxQuerySize)。阈值在 guard fragment。
    const budget = Math.min(
      guard.maxQueryTokens!,
      Math.floor(contextSize * guard.maxQuerySize!),
    );

    const messages = ctx.messages;
    const last = messages.length - 1;
    // 留给最新一条的可用窗口 = 窗口 − 最新一条之前已占用的 token。
    const prefixTokens = estimateTokens(messages.slice(0, last));
    const remaining = contextSize - prefixTokens;
    const cap = Math.min(budget, remaining);

    // 最新一条塞得进留给它的余量 → 放行。须先判，否则 seed 末条（last<base）会被误判不可恢复。
    const latestTokens = estimateTokens([messages[last]!]);
    if (latestTokens <= cap) return;

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
      // 与兄弟 stop hook 一致：先发一条可见的解释消息再终止，避免前端只见空消息。
      yield* responseUser(ctx, overflowMessage('base too large'));
      throw new StopLoop();
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
      yield* responseUser(ctx, overflowMessage('prefix fills the window'));
      throw new StopLoop();
    }

    // 超限但可恢复：截断保留前 ~cap token 真实头部 + 收窄指引放行 LLM（销毁内容 → agent 不知如何收窄 → drop 螺旋）。
    // recall（盘上已落）指明 rg/sed-n/head-n 收窄；非 recall 指明收窄发起方工具。
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
    ctx.messages = messages;
    this.logger.warn(
      `query over budget (run ${ctx.runId}): latest ${latestTokens} > ${cap} cap (prefix ${prefixTokens}, window ${contextSize}); truncated latest + narrowing directive`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: 'query over budget, truncated latest + narrowing directive',
      data: { usage: { used: latestTokens, total: contextSize } },
    };
    return;
  }
}

// 截断到 cap×TRUNCATE_TARGET_RATIO（按 estimateTokens 迭代裁尾）；不调 cache.offload → 无新句柄 → 无 fc 别名增殖。
function truncatedObservation(
  body: string,
  isObservation: boolean,
  used: number,
  cap: number,
  recall: RecallKind | null,
): string {
  // directive 也随 head 一并进窗，须先算其量级、提前从 head 预算里扣掉（否则 prefix
  // 受限 cap=remaining 时 head+directive 越窗 → 模型 400）。量级用省略量上界 used 估算即可。
  const directiveTokens = estimateTokens([
    { role: 'user', content: narrowDirective(used, cap, used, recall) },
  ]);
  const target = Math.max(
    64,
    Math.floor(cap * TRUNCATE_TARGET_RATIO) - directiveTokens,
  );
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
  const text = `${head}\n${narrowDirective(used, cap, omitted, recall)}`;
  return isObservation ? `${OBSERVATION_PREFIX}${text}` : text;
}

function narrowDirective(
  used: number,
  cap: number,
  omitted: number,
  recall: RecallKind | null,
): string {
  const recallTarget = recall?.type === 'bash' ? recall.file : null;
  return recallTarget
    ? `[query over budget: ~${used} tokens > ~${cap} cap. Above is the truncated head (~${omitted} tokens omitted); the full content remains on disk. Narrow: via the bash tool run rg -n "<keyword>" -C3 ${recallTarget} (tighter pattern / smaller -C) or sed -n "<range>" ${recallTarget} or head -n <N> ${recallTarget}; do NOT re-read the whole file or re-run the same broad search; then continue.]`
    : `[query over budget: ~${used} tokens > ~${cap} cap. Above is the truncated head (~${omitted} tokens omitted). Narrow the originating call (tighter pattern / smaller page range / smaller limit) and re-issue so the result fits, then continue.]`;
}
