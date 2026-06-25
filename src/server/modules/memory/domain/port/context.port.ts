import type { LlmMessage } from '@/shared/types/entities';
import type { ContextUsage } from '../model/memory.types';

/**
 * ContextPort — 暴露「LLM-ready 消息 + 用量」的契约。
 *
 * 两个实现刻意不对称：
 *  - ConversationMemory：持久历史层，运行期只读，作为 WorkingMemory 的种子。
 *  - WorkingMemory：瞬态、per-run，逐条 append loop 步骤并自压缩。
 * append()/compact() 仅属于 WorkingMemory——ConversationMemory 运行期无中途变更，
 * 不上契约以保持诚实。每个实例 per-run，非单例。
 */
export interface ContextPort {
  /** 构建 LLM-ready 上下文（由实现决定如何组装） */
  buildContext(): Promise<LlmMessage[]>;

  /** 当前上下文用量统计 */
  getContextUsage(): ContextUsage;
}
