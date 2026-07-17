/**
 * QueryBudgetHook 的 per-latest 单条消息上限（与 offload 无关——offload 是总量/窗口口径，阈值在 offload.windowRatio）。
 * cap = min(maxQueryTokens, contextWindow×maxQuerySize)，配置归 guard fragment（maxQuerySize / maxQueryTokens）。
 * QueryBudgetHook 再把此值与 remaining（留给最新一条的窗口余量）取 min，得 per-latest 实际上限。
 *
 *  - maxQuerySize：**单条**消息占 contextWindow 的比例（默认 0.4——单条占 4 成即 drop），跨 contextSize 自适应。
 *  - maxQueryTokens：绝对上限（默认 10000），在大 context 上拦病态胖取。取 min 与比例值。
 */
export const DEFAULT_QUERY_RATIO = 0.4;
export const DEFAULT_MAX_QUERY_TOKENS = 10_000;

/** 结构化入参——GuardConfig（含 maxQuerySize/maxQueryTokens）满足，免循环依赖。 */
export interface QueryCapOpts {
  maxQuerySize?: number;
  maxQueryTokens?: number;
}

export function queryTokenCap(
  contextSize: number,
  opts?: QueryCapOpts,
): number {
  return Math.min(
    opts?.maxQueryTokens ?? DEFAULT_MAX_QUERY_TOKENS,
    Math.floor(contextSize * (opts?.maxQuerySize ?? DEFAULT_QUERY_RATIO)),
  );
}
