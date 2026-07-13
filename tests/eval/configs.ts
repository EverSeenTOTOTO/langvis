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

/** 默认迭代上限（按 loop_usage 计 tick）。每任务可经 task.budget.maxIterations 覆盖。 */
export const DEFAULT_MAX_TICKS = 50;

/** temperature=0 求可复现；compaction 开启以锻炼该路径（设计暴露轴要观测）。 */
export function runtimeConfigFor(modelId: string): ConversationConfig {
  return {
    model: { modelId, temperature: 0 },
    loop: { threshold: 0.8, windowSize: 10, keepRecent: 4 },
    history: { threshold: 0.8, windowSize: 10 },
  } as ConversationConfig;
}
