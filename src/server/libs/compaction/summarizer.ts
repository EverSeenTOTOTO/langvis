import { container } from 'tsyringe';
import Logger from '@/server/utils/logger';
import type { LlmMessage } from '@/shared/types/entities';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import { Prompt } from '@/server/libs/prompt';

export interface FoldOptions {
  /** 要折叠的历史；若续接既有摘要，由调用方将其作为 messages[0] 传入。 */
  messages: LlmMessage[];
  windowSize: number;
  signal: AbortSignal;
  /** Prompt 模板：须含 "History" section，fold 逐块填充后 build。 */
  prompt: Prompt;
  /** 压缩模型；调用方传片段 compactModelId（或回退本 run 模型），缺省内核兜底系统默认 chat。 */
  modelId?: string;
}

// fold 原语：按 windowSize 滚动折叠 messages 成一条摘要；后续每块前置上块摘要。prompt/modelId 调用方注入，缺省兜底默认 chat。
export async function fold({
  messages,
  windowSize,
  signal,
  prompt,
  modelId,
}: FoldOptions): Promise<string> {
  if (messages.length === 0) return '';

  const llm = container.resolve<LlmProvider>(LLM_PORT);
  const resolved = modelId ?? llm.getDefaultModel('chat')?.id;

  let acc: string | null = null;
  for (let i = 0; i < messages.length; i += windowSize) {
    const chunk = messages.slice(i, i + windowSize);
    const history = formatHistory(acc, chunk);
    const content = await llm.chatContent(
      resolved,
      {
        messages: [
          { role: 'user', content: prompt.with('History', history).build() },
        ],
        temperature: 0,
      },
      signal,
    );

    const trimmed = content.trim();
    if (!trimmed) {
      Logger.warn('fold returned empty content, keeping previous summary');
      continue;
    }
    acc = trimmed;
  }

  return acc ?? '';
}

/** 格式化一块历史；滚动时前置上一块的摘要。 */
function formatHistory(acc: string | null, chunk: LlmMessage[]): string {
  const block = chunk.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
  return acc ? `[previous summary]: ${acc}\n\n${block}` : block;
}
