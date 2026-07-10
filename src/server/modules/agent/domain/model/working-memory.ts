import type { LlmMessage } from '@/shared/types/entities';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { MessageList } from '@/server/libs/messages';

export interface WorkingMemoryParams {
  /** agent 提供的种子（conv 的有效历史 LlmMessage[]）。 */
  seed: LlmMessage[];
  contextSize: number;
}

/**
 * WorkingMemory — agent run 的瞬态、per-run loop 工作记忆（贫血：状态 MessageList monad + seed 边界）。
 * 不持任何 policy：压缩（CompactionHook）、过程摘要（foldProcessSummary 生产者）都是外部 transform，
 * 经 messages（monad 值）+ baseLength（seed 边界）读写缝操作。退出时本 loop 消亡（ctx 释放即回收）。
 */
export class WorkingMemory {
  /** loop 工作列表（薄消息 monad，不可变；transform 通过替换整个值来「改」）。 */
  messages: MessageList<LlmMessage>;
  private readonly base: number;
  private readonly contextSize: number;

  constructor(params: WorkingMemoryParams) {
    this.messages = MessageList.of(params.seed);
    this.base = params.seed.length;
    this.contextSize = params.contextSize;
  }

  async buildContext(): Promise<LlmMessage[]> {
    return this.messages.toArray();
  }

  /** seed 长度（loop actions = messages.drop(base)）。 */
  get baseLength(): number {
    return this.base;
  }

  getContextUsage(): ContextUsage {
    return {
      used: estimateTokens(this.messages.toArray()),
      total: this.contextSize,
    };
  }

  append(role: LlmMessage['role'], content: string): void {
    this.messages = this.messages.append({ role, content });
  }
}
