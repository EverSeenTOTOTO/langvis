/**
 * compaction 共享内核——fold 原语（Summarizer）。被 conversation 与 agent 两域复用。
 * 纯算法、无状态、无兄弟模块依赖、不持有 ConfigFragment（fragment 归各域，基础库不反向认识域）。
 */
export { Summarizer } from './summarizer';
export { buildSummarizerPrompt } from './summarizer.prompt';
