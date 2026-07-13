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

/**
 * fold 原语：把 messages 按 windowSize 滚动折叠成一条摘要。prompt 由调用方注入
 * （lib 不认识任何域），只需含一个 "History" section——fold 每块填入历史后 build。
 *
 * 滚动：第 1 块直接折叠；之后每块前置上一块的摘要（[previous summary]）继续折叠，
 * 即"摘要的摘要"。续接场景（如历史压缩）的既有摘要在调用方作为 messages[0] 传入，
 * 随第 1 块一起折叠
 *
 * 无状态：从容器解析 LlmProvider；压缩模型由调用方经 modelId 传入（片段 compactModelId 或本 run 模型），
 * 缺省时内核兜底系统默认 chat 模型。
 */
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
