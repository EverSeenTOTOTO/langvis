/** 跨模型配置（可编辑）+ 组合式 variant（feature toggle，无固定 preset）。 */
import type { ConversationConfig } from '@/server/libs/config';

/**
 * 默认受测模型：小/本地、中、大各一，满足"大小模型同 agent 对比"。
 * memory 旧值 302:claude-opus-4-6 在 providers.json 不存在；302:qwen3.6-flash 是 compact 型。
 * 需对应 API key（OPENROUTER_API_KEY / PROXY302_API_KEY）+ 本地模型服务在线。
 */
export const MODELS = [
  'localhost:qwen3.5-9b',
  'openrouter:z-ai/glm-5.2',
  '302:qwen3.7-max',
] as const;

export const TRIALS = 10;

/**
 * 组合式 variant：一个 variant = 一组 feature 的子集（无固定 preset）。
 * base = 最小 `{ model }` + **guard 基线**（guard 始终开，是安全基线而非被测 driver 旋钮）；
 * 每个开启的 feature 往上叠一个 config fragment。
 * variant id = feature 排序后 `+` 拼接；空集记作 `bare`（= 仅 guard 基线）。
 *   compact / compact+offload / bare / *
 * CLI: --variants compact+offload,bare,*
 *   `*`|`all` = 全 feature；`bare` = 空 feature（仅 guard 基线）。省略 --variants = compact。
 *
 * guard 不可关（2026-07-20 决策）：测的是 compact/offload driver，guard 是
 * "失败 run 不挂死"的 harness 保底，归 agent driver 管（maxIter/stuck/budget 三闸）。
 * 故无 guard-off 挂死风险，runner 不再需要硬上限收口。
 */
export type Feature = 'compact' | 'offload';

export const ALL_FEATURES: readonly Feature[] = ['compact', 'offload'];

const COMPACT_FRAGMENT = (b: ConversationConfig): ConversationConfig => ({
  ...b,
  loop: { threshold: 0.95, windowSize: 10, keepRecent: 4 },
  history: { threshold: 0.8, windowSize: 10 },
});
const OFFLOAD_FRAGMENT = (b: ConversationConfig): ConversationConfig => ({
  ...b,
  offload: {},
});
/** guard 基线：始终注入（非 feature、不可关）。 */
const GUARD_BASELINE = (b: ConversationConfig): ConversationConfig => ({
  ...b,
  guard: {
    maxIterations: 50,
    maxTokenUsage: 1_000_000,
    stuckThreshold: 5,
    maxQuerySize: 0.4,
    maxQueryTokens: 10_000,
  },
});

const FRAGMENTS: Record<
  Feature,
  (b: ConversationConfig) => ConversationConfig
> = {
  compact: COMPACT_FRAGMENT,
  offload: OFFLOAD_FRAGMENT,
};

export type Variant = ReadonlySet<Feature>;

/** 默认 variant = compact（guard 基线隐含）。 */
export const DEFAULT_VARIANT = variantId(new Set<Feature>(['compact']));

const ALIASES: Record<string, Variant> = {
  bare: new Set<Feature>(),
  '*': new Set<Feature>(ALL_FEATURES),
  all: new Set<Feature>(ALL_FEATURES),
};

/** variant → 规范 id（排序 `+` 拼；空集 = `bare`）。作为 results.jsonl 的 variant 键。 */
export function variantId(v: Variant): string {
  if (v.size === 0) return 'bare';
  return [...v].sort().join('+');
}

/** 单个 variant token → Variant。支持别名与 `+` 拼 feature；未知 feature 抛错。 */
export function parseVariant(token: string): Variant {
  const t = token.trim();
  if (ALIASES[t]) return ALIASES[t];
  if (!t) return new Set<Feature>();
  const feats = t
    .split('+')
    .map(f => f.trim())
    .filter(Boolean) as Feature[];
  for (const f of feats) {
    if (!(f in FRAGMENTS)) {
      throw new Error(
        `unknown feature "${f}" (known: ${ALL_FEATURES.join(', ')})`,
      );
    }
  }
  return new Set<Feature>(feats);
}

/** variant token → 规范 id（别名/`+`集 都归一为排序 id）。 */
export function canonicalVariantId(token: string): string {
  return variantId(parseVariant(token));
}

/** base = 最小 `{ model }` + guard 基线；variant 内每个开启 feature 叠其 fragment。 */
export function runtimeConfigForVariant(
  modelId: string,
  variantIdOrToken: string = DEFAULT_VARIANT,
): ConversationConfig {
  const variant =
    variantIdOrToken in ALIASES
      ? ALIASES[variantIdOrToken]!
      : parseVariant(variantIdOrToken);
  let cfg: ConversationConfig = GUARD_BASELINE({
    model: { modelId, temperature: 0 },
  });
  for (const f of ALL_FEATURES) if (variant.has(f)) cfg = FRAGMENTS[f](cfg);
  return cfg;
}
