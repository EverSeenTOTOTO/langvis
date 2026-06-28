import type { LlmMessage } from '@/shared/types/entities';
import type { Logger } from '@/server/utils/logger';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { buildSummarizerPrompt } from './summarizer.prompt';

/**
 * Summarizer —— fold 原语的实现。
 *
 * fold(prevSummary, messages): 以 prevSummary 为种子，按滑动窗口逐块归纳——
 * 每块把「既有摘要 + 本块消息」交给 LLM 产出新摘要（即"摘要的摘要"，可递归）。
 * 首次 prevSummary=null。
 *
 * 三处复用同一原语：mid-loop IterationCompaction / loop-exit 过程摘要 / post-turn HistoryCompaction。
 */
export class Summarizer {
  constructor(
    private readonly llm: LlmPort,
    private readonly logger: Logger,
    private readonly windowSize = 10,
    private readonly modelId: string | undefined,
  ) {}

  async fold(
    prevSummary: string | null,
    messages: LlmMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    if (messages.length === 0) return prevSummary ?? '';

    let acc = prevSummary;
    for (let i = 0; i < messages.length; i += this.windowSize) {
      const chunk = messages.slice(i, i + this.windowSize);
      acc = await this.summarizeChunk(acc, chunk, signal);
    }

    return acc ?? '';
  }

  private async summarizeChunk(
    prev: string | null,
    chunk: LlmMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const content = await this.llm.chatContent(
      this.modelId,
      {
        messages: [
          { role: 'user', content: buildSummarizerPrompt(prev, chunk) },
        ],
        temperature: 0,
      },
      signal,
      this.logger,
    );

    const trimmed = content.trim();
    if (!trimmed) {
      this.logger.warn(
        'Summarizer returned empty content, keeping previous summary',
      );
      return prev ?? '';
    }
    return trimmed;
  }
}
