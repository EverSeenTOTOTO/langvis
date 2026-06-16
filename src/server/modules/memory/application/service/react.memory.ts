import type { LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ReActStep } from '@/shared/types/render';
import { BaseMemory } from '../../domain/model/base-memory';

/**
 * ReActMemory — 带 step 摘要的上下文策略。
 *
 * 基于 SlidingWindowMemory 的滑动窗口，但 assistant 消息
 * 如果包含 steps 则自动附加摘要（thought + action → observation）。
 * 适用于 ReAct agent 的多轮推理场景。
 */
export class ReActMemory extends BaseMemory {
  readonly windowSize: number;

  constructor(params: {
    history: import('@/shared/types/entities').Message[];
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
        let content = msg.content;

        if (msg.role === Role.ASSIST && msg.steps?.length) {
          const summary = this.summarizeSteps(msg.steps);
          if (summary) {
            content = `${summary}\n\n${content}`;
          }
        }

        messages.push({ role: msg.role as LlmMessage['role'], content });
      }
    }

    return messages;
  }

  private summarizeSteps(steps: ReActStep[]): string {
    if (steps.length === 0) return '';

    const lines = steps.map(step => {
      const parts = [`> 思考: ${step.thought}`];
      if (step.action) {
        const outputHint = step.observation
          ? step.observation.slice(0, 100)
          : '完成';
        parts.push(`> 调用 ${step.action.toolName}: ${outputHint}`);
      }
      return parts.join('\n');
    });

    return lines.join('\n');
  }
}
