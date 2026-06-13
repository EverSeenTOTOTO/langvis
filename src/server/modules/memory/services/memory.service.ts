import { singleton } from 'tsyringe';
import type { Message, LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ReActStep } from '@/shared/types/render';
import { ContextWindow } from '../domain/context-window';
import type { ContextUsage } from '../domain/memory.types';
import type { MemoryPort } from '../domain/memory.port';

@singleton()
export class MemoryService implements MemoryPort {
  async summarize(
    history: Message[],
    options: {
      windowSize?: number;
      systemPrompt?: string;
      memoryType?: 'slide_window' | 'react';
      modelId?: string;
    },
  ): Promise<LlmMessage[]> {
    const windowSize = options.windowSize ?? 20;
    const messages: LlmMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of history) {
      if (msg.role === Role.USER && msg.meta?.hidden) {
        messages.push({ role: 'user', content: msg.content });
      }
    }

    const turns = this.groupIntoTurns(history);

    const recentTurns = turns.slice(-windowSize);
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

        if (
          msg.role === Role.ASSIST &&
          options.memoryType === 'react' &&
          msg.steps?.length
        ) {
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

  summarizeSteps(steps: ReActStep[]): string {
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

  estimateUsage(
    messages: LlmMessage[],
    maxSize: number,
    modelId: string,
  ): ContextUsage {
    const window = new ContextWindow(messages, maxSize, modelId);
    return window.usage;
  }

  private groupIntoTurns(messages: Message[]): Message[][] {
    const turns: Message[][] = [];
    let current: Message[] = [];

    for (const msg of messages) {
      if (msg.role === Role.SYSTEM) continue;
      if (msg.role === Role.USER && msg.meta?.hidden) continue;

      current.push(msg);

      if (msg.role === Role.ASSIST) {
        turns.push(current);
        current = [];
      }
    }

    if (current.length > 0) {
      turns.push(current);
    }

    return turns;
  }
}
