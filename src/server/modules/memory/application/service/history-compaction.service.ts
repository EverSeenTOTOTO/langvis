import { inject, singleton } from 'tsyringe';
import type { LlmMessage, Message } from '@/shared/types/entities';
import type { ModelConfig } from '@/shared/types';
import { readConfigFragment } from '@/server/libs/config/config-fragment';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { winstonLogger } from '@/server/utils/logger';
import type { CompactionConfig } from '../../domain/service/compaction-config';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { findLatestCompactionSummary } from '@/server/utils/compaction-summary';
import { Summarizer } from '../../domain/service/summarizer';
import type { ConversationCompactionResult } from '../../domain/port/conversation-memory.port';

/**
 * HistoryCompactionService —— 历史层压缩（fold）算法（memory 内部，不再是对外端口）。
 *
 * 输入原始历史消息，判定是否需要压缩（有效历史用量超阈），需要则用 fold 把
 * 「上一个 C + tail」滚动折叠成新 C，返回新 C 的载荷（不含持久化）。持久化由 conv 负责
 * （compact 消息存储写是 conv 的职责），避免 memory 域反向依赖 conversation repo。
 *
 * 由 ConversationMemoryService（memory 内部）在持有的 ConversationMemory 历史上调用——conv 不直接
 * 接触本服务，而是经 ConversationMemoryPort.compact 间接触发。
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
    runtimeConfig: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<ConversationCompactionResult | null> {
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
    const usage = {
      used: estimateTokens(toLlmMessages(effective), modelId),
      total: contextSize,
    };

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

    // 压缩后有效历史 = [新 C]；其用量即会话层用量，供 handler 直接回报。
    const postUsage = {
      used: estimateTokens([{ role: 'user', content }], modelId),
      total: contextSize,
    };

    return {
      content,
      startRef: summary?.id ?? messages[0]?.id ?? '',
      usage: postUsage,
    };
  }
}

function toLlmMessages(messages: Message[]): LlmMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}
