import { Prompt } from '@/server/libs/prompt';

/** 折叠 turn 动作轨迹为过程摘要（仅记工作，不复述最终答案）的共享 Prompt 模板。
 *  被 loop 内 compaction（agent 侧，post-observation）与 turn process-summary（conv 侧，turn-end）复用——
 *  两者都是「把动作轨迹压成工作摘要」，表述一致。lib 不认识任何域，仅提供模板文本。 */
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
