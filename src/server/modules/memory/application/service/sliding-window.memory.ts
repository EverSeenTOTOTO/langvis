import type { LlmMessage, Message } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { BaseMemory } from '../../domain/model/base-memory';

/**
 * SlidingWindowMemory — 最简单的上下文策略。
 *
 * 取最近 N 个 turn，超出的部分用截断提示替代。
 * 不做 step 摘要，适用于简单对话。
 */
export class SlidingWindowMemory extends BaseMemory {
  readonly windowSize: number;

  constructor(params: {
    history: Message[];
    systemPrompt?: string;
    contextSize: number;
    modelId: string;
    windowSize: number;
  }) {
    super(params);
    this.windowSize = params.windowSize;
  }

  async buildContext(): Promise<LlmMessage[]> {
    const messages: LlmMessage[] = [];

    if (this.systemPrompt) {
      messages.push({ role: 'system', content: this.systemPrompt });
    }

    for (const msg of this.history) {
      if (msg.role === Role.USER && msg.meta?.hidden) {
        messages.push({ role: 'user', content: msg.content });
      }
    }

    const turns = this.groupIntoTurns(this.history);
    const recentTurns = turns.slice(-this.windowSize);
    const truncatedCount = turns.length - recentTurns.length;

    if (truncatedCount > 0) {
      messages.push({
        role: 'user',
        content: `[Earlier conversation history (${truncatedCount} turns) has been truncated to fit context window]`,
      });
    }

    for (const turn of recentTurns) {
      for (const msg of turn) {
        messages.push({
          role: msg.role as LlmMessage['role'],
          content: msg.content,
        });
      }
    }

    return messages;
  }
}
