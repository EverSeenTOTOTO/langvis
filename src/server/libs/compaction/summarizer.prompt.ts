import type { LlmMessage } from '@/shared/types/entities';

function formatMessages(messages: LlmMessage[]): string {
  return messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
}

/**
 * Builds the Summarizer prompt (preserves who / when / did what / key facts).
 * A non-null prevSummary means this is a rolling fold increment (existing
 * summary + new messages → updated summary); null means an initial summary of
 * the first block. Kept in its own file so the template can be swapped without
 * touching the fold flow.
 */
export function buildSummarizerPrompt(
  prevSummary: string | null,
  messages: LlmMessage[],
): string {
  const block = formatMessages(messages);

  if (prevSummary) {
    return [
      'You are a conversation compactor. Below are an "existing summary" and "new messages". Fold the new messages into the existing summary and produce an updated summary.',
      'Preserve: who, when, did what, plus key facts and open items. Keep it concise and chronological; do not fabricate; do not drop key information.',
      '',
      '[Existing summary]',
      prevSummary,
      '',
      '[New messages]',
      block,
      '',
      'Output the updated summary directly (no extra explanation, no Markdown headings):',
    ].join('\n');
  }

  return [
    'You are a conversation compactor. Compress the messages below into a summary, preserving: who, when, did what, plus key facts and open items. Keep it concise and chronological; do not fabricate.',
    '',
    '[Messages]',
    block,
    '',
    'Output the summary directly (no extra explanation, no Markdown headings):',
  ].join('\n');
}
