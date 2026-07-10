import { Prompt } from '@/server/libs/prompt';

/**
 * turn 过程摘要 prompt：被迭代压缩（CompactionHook 的 loop 回顾）与 loop 退出摘要
 * （ProcessSummaryHook）共用。把一个 turn 的动作轨迹折叠成简短过程摘要，
 * 只记工作轨迹（最终答案另发，不复述）。
 */
export const PROCESS_SUMMARY_PROMPT = Prompt.empty()
  .with('Role', 'You compact an agent turn into a concise process summary.')
  .with(
    'Instructions',
    'Fold the history below into a concise process summary of the WORK done: tools called and why, what was attempted, difficulties or errors, intermediate results, and key decisions. The history may begin with a previous summary — incorporate it. Capture the trajectory of work only — the final answer is delivered to the user separately and must NOT be restated or paraphrased. Be concise and chronological; do not fabricate.',
  )
  .with('History', '')
  .with(
    'Output',
    'Output only the process summary (no extra explanation, no Markdown headings).',
  );
