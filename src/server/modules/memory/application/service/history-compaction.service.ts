import { inject, singleton } from 'tsyringe';
import type { LlmMessage, Message } from '@/shared/types/entities';
import type { ModelConfig } from '@/shared/types';
import { readConfigFragment } from '@/server/libs/config/config-fragment';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { winstonLogger } from '@/server/utils/logger';
import type { CompactionConfig } from '../../domain/service/compaction-config';
import { measureUsage } from '../../domain/service/measure-usage';
import { findLatestCompactionSummary } from '../../domain/service/compaction-summary.util';
import { Summarizer } from '../../domain/service/summarizer';

export interface CompactionResult {
  content: string;
  /** 调试用：上一个 C 的 id，或被总结范围的首条消息 id */
  startRef: string;
}

/**
 * HistoryCompactionService —— 历史层压缩（post-turn）。
 *
 * 输入原始历史消息，判定是否需要压缩（有效历史用量超阈），需要则用 fold 把
 * 「上一个 C + tail」滚动折叠成新 C，返回新 C 的载荷（不含持久化）。
 * 持久化由调用方（complete-turn.handler）负责，避免 memory 域反向依赖 conversation repo。
 *
 * repo-free：便于单测，且不引入跨模块循环依赖。
 */
@singleton()
export class HistoryCompactionService {
  private readonly logger = winstonLogger.child({
    source: 'HistoryCompaction',
  });

  constructor(@inject(LLM_PORT) private readonly llm: LlmPort) {}

  async compact(params: {
    messages: Message[];
    contextSize: number;
    /** 已 parse 的 runtimeConfig——modelId 与压缩参数由本服务自取，调用方无需感知。 */
    runtimeConfig: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<CompactionResult | null> {
    const { messages, contextSize, runtimeConfig, signal } = params;
    const modelId = readConfigFragment<ModelConfig>(
      'model',
      runtimeConfig,
    ).modelId;
    if (!modelId) return null;
    const cc = readConfigFragment<CompactionConfig>('memory', runtimeConfig);
    const threshold = cc.threshold;
    const windowSize = cc.windowSize;

    const { summary, index } = findLatestCompactionSummary(messages);
    const tail = summary ? messages.slice(index + 1) : messages;
    if (tail.length === 0) return null;

    const effective = summary ? [summary, ...tail] : tail;
    const usage = measureUsage(toLlmMessages(effective), modelId, contextSize);

    if (usage.used <= contextSize * threshold) return null;

    this.logger.info(
      `History over threshold (${usage.used}/${usage.total}, ${(threshold * 100).toFixed(0)}%) — compacting ${tail.length} messages`,
    );

    const summarizer = new Summarizer(
      this.llm,
      this.logger,
      windowSize,
      modelId,
    );
    const content = await summarizer.fold(
      summary?.content ?? null,
      toLlmMessages(tail),
      signal,
    );

    if (!content) return null;

    return {
      content,
      startRef: summary?.id ?? messages[0]?.id ?? '',
    };
  }
}

function toLlmMessages(messages: Message[]): LlmMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}
