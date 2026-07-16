/**
 * compaction 共享内核——fold 原语。被 conversation 与 agent 两域复用。
 * 纯算法、无状态、无兄弟模块依赖、不持有 ConfigFragment（fragment 归各域，基础库不反向认识域）。
 * Prompt 由调用方注入（写在各业务模块），lib 不认识任何域。
 */
export { fold } from './summarizer';
export type { FoldOptions } from './summarizer';
export { PROCESS_SUMMARY_PROMPT } from './prompts';
