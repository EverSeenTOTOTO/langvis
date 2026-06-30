/**
 * compaction 共享内核——fold 原语（Summarizer）。
 *
 * 被 conversation（post-turn 历史压缩，配置见 conv 的 history 片段）与 agent（mid-loop 迭代压缩 /
 * loop-exit 过程摘要，配置见 agent 的 loop 片段）两域复用。纯算法、无状态、无兄弟模块依赖、不持有
 * 任何 ConfigFragment（fragment 归各域，基础库不反向认识域——见各域 *.module 的 fragment 自注册）。
 */
export { Summarizer } from './summarizer';
export { buildSummarizerPrompt } from './summarizer.prompt';
