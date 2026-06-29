import type { LlmMessage, Message } from '@/shared/types/entities';
import type { ContextUsage } from '@/server/utils/estimateTokens';

export const CONVERSATION_MEMORY_PORT = Symbol('CONVERSATION_MEMORY_PORT');

export interface ConversationMemoryConfig {
  contextSize: number;
  modelId: string;
  runtimeConfig: Record<string, unknown>;
}

/** 历史压缩（fold）产物：新 C 载荷 + 压缩后用量。conv 落盘 C 后经端口 append 回 memory。 */
export interface ConversationCompactionResult {
  content: string;
  startRef: string;
  usage: ContextUsage;
}

/**
 * ConversationMemoryPort —— memory 对 conv 暴露的会话记忆同步 Customer-Supplier 契约
 * （conversationId 索引——类似 LoopMemoryPort 之于 WorkingMemory）。
 *
 * ConversationMemory（有效历史 + 用量 + fold）归 memory 拥有；conv 经本端口驱动其生命周期：
 *  - activate：会话激活时一次性灌入消息 + 配置（memory 据此构造 ConversationMemory）。
 *  - append：turn 的 user/assistant/compact 消息落盘后增量追加。
 *  - buildContext / getUsage：取有效历史种子 / 会话层用量。
 *  - compact：post-turn 历史压缩（memory 在持有的历史上 fold，返回新 C 供 conv 落盘 + append）。
 *  - dispose：会话关闭释放。
 *
 * conv 因此不再回调 conv 取历史、不再 new 任何 memory 模型——一次 activate 后按 conversationId 操作。
 */
export interface ConversationMemoryPort {
  activate(
    conversationId: string,
    messages: Message[],
    config: ConversationMemoryConfig,
  ): void;
  buildContext(conversationId: string): Promise<LlmMessage[]>;
  getUsage(conversationId: string): ContextUsage;
  append(conversationId: string, message: Message): void;
  compact(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<ConversationCompactionResult | null>;
  dispose(conversationId: string): void;
}
