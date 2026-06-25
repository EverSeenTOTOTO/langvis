import type { LlmMessage } from '@/shared/types/entities';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '../model/memory.types';

/**
 * measureUsage — 上下文用量度量（替代已删的 ContextWindow）。
 *
 * ContextWindow 是个「四不像」：唯一活表面是 `.usage`（= estimateTokens 包一层），
 * `.isOverThreshold` 是 0 调用者的死代码。阈值判断由各调用方按自身 config 自行比较。
 */
export function measureUsage(
  messages: LlmMessage[],
  modelId: string,
  total: number,
): ContextUsage {
  return { used: estimateTokens(messages, modelId), total };
}
