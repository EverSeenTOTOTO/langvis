import type { Message, LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ToolCallRecord } from '@/shared/types/render';
import { ContextWindow } from './context-window';
import type { ContextUsage } from './memory.types';

export class MemoryService {
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
          msg.toolCallRecords?.length
        ) {
          const summary = this.summarizeToolCalls(msg.toolCallRecords);
          if (summary) {
            content = `${summary}\n\n${content}`;
          }
        }

        messages.push({ role: msg.role as LlmMessage['role'], content });
      }
    }

    return messages;
  }

  summarizeToolCalls(toolCallRecords: ToolCallRecord[]): string {
    if (toolCallRecords.length === 0) return '';

    const lines = toolCallRecords.map(tc => {
      if (tc.status === 'failed') {
        return `> 调用 ${tc.toolName}: 失败 - ${tc.error}`;
      }
      const outputHint =
        typeof tc.output === 'string' ? tc.output.slice(0, 100) : '完成';
      return `> 调用 ${tc.toolName}: ${outputHint}`;
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
