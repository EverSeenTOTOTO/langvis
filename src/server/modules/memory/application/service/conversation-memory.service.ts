import { inject, singleton } from 'tsyringe';
import type { LlmMessage, Message } from '@/shared/types/entities';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { ConversationMemory } from '../../domain/model/conversation-memory';
import type {
  ConversationMemoryConfig,
  ConversationMemoryPort,
  ConversationCompactionResult,
} from '../../domain/port/conversation-memory.port';
import { HistoryCompactionService } from './history-compaction.service';

interface Entry {
  memory: ConversationMemory;
  config: ConversationMemoryConfig;
}

/**
 * ConversationMemoryService —— memory 对 conv 的会话记忆同步 Customer-Supplier 实现。
 *
 * 持有 per-conversation 的 ConversationMemory（`Map<conversationId, Entry>`），由 conv 经
 * ConversationMemoryPort 驱动生命周期（activate / append / dispose）。有效历史与用量由 ConversationMemory
 * 算；历史压缩（fold）委托 HistoryCompactionService（memory 内部）在持有的历史上执行。
 * memory 全程只持有 conversationId，不感知 agent；有效历史算法 + fold 都在 memory。
 */
@singleton()
export class ConversationMemoryService implements ConversationMemoryPort {
  private readonly entries = new Map<string, Entry>();

  constructor(
    @inject(HistoryCompactionService)
    private readonly compaction: HistoryCompactionService,
  ) {}

  activate(
    conversationId: string,
    messages: Message[],
    config: ConversationMemoryConfig,
  ): void {
    this.entries.set(conversationId, {
      memory: new ConversationMemory({
        history: messages,
        contextSize: config.contextSize,
        modelId: config.modelId,
      }),
      config,
    });
  }

  async buildContext(conversationId: string): Promise<LlmMessage[]> {
    return this.require(conversationId).memory.buildContext();
  }

  getUsage(conversationId: string): ContextUsage {
    return this.require(conversationId).memory.getContextUsage();
  }

  append(conversationId: string, message: Message): void {
    this.require(conversationId).memory.append(message);
  }

  async compact(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<ConversationCompactionResult | null> {
    const { memory, config } = this.require(conversationId);
    return this.compaction.compact({
      messages: memory.getMessages(),
      contextSize: config.contextSize,
      runtimeConfig: config.runtimeConfig,
      signal,
    });
  }

  dispose(conversationId: string): void {
    this.entries.delete(conversationId);
  }

  private require(conversationId: string): Entry {
    const entry = this.entries.get(conversationId);
    if (!entry) {
      throw new Error(
        `ConversationMemory: ${conversationId} not activated (activate missing)`,
      );
    }
    return entry;
  }
}
