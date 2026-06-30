/**
 * compaction 共享内核——fold 原语（Summarizer）+ 压缩配置片段。
 *
 * 被 conversation（post-turn 历史压缩）与 agent（mid-loop 迭代压缩 / loop-exit 过程摘要）
 * 两域复用。纯算法 + 配置，无状态、无兄弟模块依赖。
 *
 * 副作用：导入本 barrel 会自注册 MEMORY_FRAGMENT（defineConfigFragment）。
 */
export { Summarizer } from './summarizer';
export { buildSummarizerPrompt } from './summarizer.prompt';
export { MEMORY_FRAGMENT } from './compaction-config';
export type { CompactionConfig } from './compaction-config';
