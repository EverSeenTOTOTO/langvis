import type { LlmMessage } from '@/shared/types/entities';

function formatMessages(messages: LlmMessage[]): string {
  return messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
}

/**
 * Summarizer 的 prompt 构造（保留 who / when / do what / 关键事实）。
 * prevSummary 非空即滚动折叠的增量步（既有摘要 + 新增消息 → 更新摘要），为空则做首块初始摘要。
 * 独立文件便于替换模板而不动 fold 主流程。
 */
export function buildSummarizerPrompt(
  prevSummary: string | null,
  messages: LlmMessage[],
): string {
  const block = formatMessages(messages);

  if (prevSummary) {
    return [
      '你是对话压缩器。下面给出「既有摘要」和「新增消息」，请把新增消息融入既有摘要，产出一份更新后的摘要。',
      '须保留：谁(who)、何时(when)、做了什么(do what)、以及关键事实与未决事项。保持简洁、按时间顺序、不要编造、不要遗漏关键信息。',
      '',
      '【既有摘要】',
      prevSummary,
      '',
      '【新增消息】',
      block,
      '',
      '请直接输出更新后的摘要（不要多余解释、不要 Markdown 标题）：',
    ].join('\n');
  }

  return [
    '你是对话压缩器。请把下面的消息压缩为一份摘要，保留：谁(who)、何时(when)、做了什么(do what)、以及关键事实与未决事项。保持简洁、按时间顺序、不要编造。',
    '',
    '【消息】',
    block,
    '',
    '请直接输出摘要（不要多余解释、不要 Markdown 标题）：',
  ].join('\n');
}
