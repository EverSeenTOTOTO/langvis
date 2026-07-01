import { container } from 'tsyringe';
import Logger from '@/server/utils/logger';
import type { LlmMessage } from '@/shared/types/entities';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import { buildSummarizerPrompt } from './summarizer.prompt';

/**
 * Summarizer —— fold 原语的实现。
 *
 * fold(prevSummary, messages, windowSize): 以 prevSummary 为种子，按滑动窗口逐块归纳——
 * 每块把「既有摘要 + 本块消息」交给 LLM 产出新摘要（即"摘要的摘要"，可递归）。
 * 首次 prevSummary=null。
 *
 * 三处复用同一原语：mid-loop IterationCompaction / loop-exit 过程摘要 / post-turn HistoryCompaction。
 *
 * 无状态：每次调用从容器解析 LlmProvider 并自取 compact 模型（缺省回退对话模型）。
 */
export class Summarizer {
  async fold(
    prevSummary: string | null,
    messages: LlmMessage[],
    windowSize: number,
    signal: AbortSignal,
  ): Promise<string> {
    if (messages.length === 0) return prevSummary ?? '';

    let acc = prevSummary;
    for (let i = 0; i < messages.length; i += windowSize) {
      acc = await this.summarizeChunk(
        acc,
        messages.slice(i, i + windowSize),
        signal,
      );
    }

    return acc ?? '';
  }

  private async summarizeChunk(
    prev: string | null,
    chunk: LlmMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const llm = container.resolve<LlmProvider>(LLM_PORT);
    const content = await llm.chatContent(
      llm.getDefaultModel('compact')?.id,
      {
        messages: [
          { role: 'user', content: buildSummarizerPrompt(prev, chunk) },
        ],
        temperature: 0,
      },
      signal,
    );

    const trimmed = content.trim();
    if (!trimmed) {
      Logger.warn(
        'Summarizer returned empty content, keeping previous summary',
      );
      return prev ?? '';
    }
    return trimmed;
  }
}
