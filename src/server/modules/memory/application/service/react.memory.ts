import type { LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ReActStep } from '@/shared/types/render';
import { BaseMemory } from '../../domain/model/base-memory';

/**
 * ReActMemory — 带 step 摘要的上下文策略。
 *
 * 遍历全部历史 turn，对包含 steps 的 assistant 消息前置摘要
 * （thought + action → observation）。不做截断
 */
export class ReActMemory extends BaseMemory {
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

    // TODO(compression): 引入按 token 预算压缩历史 turn 的策略，取代原先的
    // 简单滑动窗口截断。当前先全量纳入，超长上下文由后续策略处理。
    const turns = this.groupIntoTurns(this.history);

    for (const turn of turns) {
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
