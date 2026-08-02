// compaction 共享内核（fold 原语），conversation 与 agent 两域复用。纯算法、无状态、不认识任何域；Prompt 由调用方注入。
export { fold } from './summarizer';
export type { FoldOptions } from './summarizer';
export { PROCESS_SUMMARY_PROMPT } from './prompts';
