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
    loop: { threshold: 0.95, windowSize: 10, keepRecent: 4 },
    history: { threshold: 0.8, windowSize: 10 },
    guard: {
      maxIterations: 50,
      maxTokenUsage: 1_000_000,
      stuckThreshold: 5,
      maxQuerySize: 0.4,
      maxQueryTokens: 10_000,
    },
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

/** 默认变体 = compact-only。四变体 = 现有两轴（fold 压缩 × offload 护栏）的组合；
 *  新增机制时按同一思路扩，描述只点意图、不枚举 on/off。 */
export const DEFAULT_VARIANT = 'compact-only';

/** bare = 裸 loop（baseline，无任何压缩/护栏）。新机制默认在此变体关闭。 */
export const VARIANTS: readonly Variant[] = [
  {
    id: DEFAULT_VARIANT,
    description: '现状默认压缩（fold）',
    apply: base => base,
  },
  {
    id: 'bare',
    description: '裸 loop，无压缩无护栏（baseline）',
    apply: base => {
      const { loop: _l, history: _h, ...rest } = base;
      return rest as ConversationConfig;
    },
  },
  {
    id: 'offload-only',
    description: '仅 offload 体积护栏，不压缩',
    apply: base => {
      const { loop: _l, history: _h, ...rest } = base;
      return {
        ...rest,
        offload: {},
      } as ConversationConfig;
    },
  },
  {
    id: 'hybrid',
    description: '压缩 + offload 护栏都开',
    apply: base => ({
      ...base,
      offload: {},
    }),
  },
  {
    id: 'audit-on',
    description: '默认压缩 + post-LLM 答复审计（反幻觉独立子 run 校验）',
    apply: base => ({
      ...base,
      audit: { enabled: true, maxRejections: 2 },
    }),
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
