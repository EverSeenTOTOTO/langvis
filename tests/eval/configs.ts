/** 跨模型配置（可编辑）+ 组合式 variant（feature toggle，无固定 preset）。 */
import type { ConversationConfig } from '@/server/libs/config';

// 默认受测模型：小/本地、中、大各一（需对应 API key 与本地模型在线）。
export const MODELS = [
  'localhost:qwen3.5-9b',
  'openrouter:z-ai/glm-5.2',
  '302:qwen3.7-max',
] as const;

export const TRIALS = 10;

// variant = 排序 feature `+` 拼成 id；空集=bare。guard 始终开（安全基线，非被测旋钮）。
// 省略 --variants = compact；CLI: --variants compact+offload,bare,*（`*`=全 feature）。
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
