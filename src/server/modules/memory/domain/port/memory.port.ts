import type { LlmMessage } from '@/shared/types/entities';
import type { ContextUsage } from '../model/memory.types';

/**
 * MemoryPort — Memory 策略接口。
 *
 * Memory 拥有自己的数据（history, config），
 * 通过无参方法暴露构建好的上下文和用量统计。
 * 每个实例是 per-run 的，不是单例。
 */
export interface MemoryPort {
  /** 构建 LLM-ready 上下文（system prompt + history, 由策略决定如何组装） */
  buildContext(): Promise<LlmMessage[]>;

  /** 当前上下文用量统计（基于内部 history + config） */
  getContextUsage(): ContextUsage;
}
