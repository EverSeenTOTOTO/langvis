/** 跨模型配置（可编辑）+ 固定 runtimeConfig（只换 model.modelId）。 */
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

export function runtimeConfigFor(modelId: string): ConversationConfig {
  return {
    model: { modelId, temperature: 0 },
    loop: { threshold: 0.8, windowSize: 10, keepRecent: 4 },
    history: { threshold: 0.8, windowSize: 10 },
    guard: { maxIterations: 50, maxTokenUsage: 1_000_000, stuckThreshold: 5 },
  } satisfies ConversationConfig;
}

/**
 * 配置轴变体：对 base ConversationConfig 的纯函数 patch。模型固定、换 variant，
 * 结果差异归因于 driver——这是"测 driver 而非模型"的主战场（见 eval plan §0）。
 * headroom = 同 (model, task) 最优 variant − baseline variant。
 */
export type Variant = {
  readonly id: string;
  readonly description: string;
  readonly apply: (base: ConversationConfig) => ConversationConfig;
};

export const DEFAULT_VARIANT = 'default';

/**
 * G2 先立维度 + baseline。阈值/策略变体等（G4.3 压缩触发场景、G2.5 搜索法）再加。
 * no-compaction 省 loop/history fragment——eval 不经 AJV，故 fragment 缺省即真关
 * （CompactionHook/CompactTransform 各 if(!loop/history) return）。两层压缩都关。
 */
export const VARIANTS: readonly Variant[] = [
  {
    id: DEFAULT_VARIANT,
    description: '现状默认压缩（loop/history 开，阈值 0.8）',
    apply: base => base,
  },
  {
    id: 'no-compaction',
    description: 'baseline：loop/history fragment 省略 = 两层压缩全关',
    apply: base => {
      const { loop: _l, history: _h, ...rest } = base;
      return rest as ConversationConfig;
    },
  },
];

export function findVariant(id: string): Variant | undefined {
  return VARIANTS.find(v => v.id === id);
}

/** base runtimeConfig 经 variant patch 后的本 run 配置。 */
export function runtimeConfigForVariant(
  modelId: string,
  variantId: string = DEFAULT_VARIANT,
): ConversationConfig {
  const variant = findVariant(variantId) ?? findVariant(DEFAULT_VARIANT)!;
  return variant.apply(runtimeConfigFor(modelId));
}
