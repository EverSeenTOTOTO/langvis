/**
 * 顶尖模型判官：对模糊正确性任务，按 rubric 给 final answer 打 pass/fail。
 * 复用容器里真实 LlmProvider（已注册于 LLM_PORT）；judge 调用同样要裹 TraceContext。
 */
import { container } from 'tsyringe';
import type { EnrichedEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { TraceContext } from '@/server/middleware/trace-context';
import type { Grade, JudgeSpec } from './types';

/** 判官模型（默认用最大的；可改）。 */
export const JUDGE_MODEL = '302:qwen3.7-max';

/** 末条 text_chunk = response_user 交付的 final answer。 */
function finalAnswer(events: readonly EnrichedEvent[]): string {
  const chunks = events.filter(e => e.type === 'text_chunk');
  return chunks.length ? chunks[chunks.length - 1]!.content : '';
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function judgeWith(
  spec: JudgeSpec,
  events: readonly EnrichedEvent[],
): Promise<Grade> {
  const answer = finalAnswer(events);
  if (!answer.trim()) {
    return { pass: false, reason: 'no final answer (empty response_user)' };
  }
  const llm = container.resolve<LlmPort>(LLM_PORT);
  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a strict grader. Reply ONLY a JSON object {"pass":boolean,"reason":string}.',
    },
    {
      role: 'user' as const,
      content: `Rubric:\n${spec.rubric}\n\nAnswer to grade:\n${answer}\n\nReply JSON only.`,
    },
  ];
  const raw = await TraceContext.run({ requestId: 'eval-judge' }, () =>
    llm.chatContent(
      JUDGE_MODEL,
      { messages, temperature: 0 },
      new AbortController().signal,
    ),
  );
  const parsed = extractJson(raw);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'pass' in parsed &&
    typeof (parsed as { pass: unknown }).pass === 'boolean'
  ) {
    const p = parsed as { pass: boolean; reason?: unknown };
    return { pass: p.pass, reason: String(p.reason ?? '') };
  }
  return { pass: false, reason: `judge non-JSON: ${raw.slice(0, 120)}` };
}
