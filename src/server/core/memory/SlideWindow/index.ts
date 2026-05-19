import { AgentEvent } from '@/shared/types';
import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { generateId } from '@/shared/utils';
import { Message, Role } from '@/shared/types/entities';
import { Memory } from '..';

@memory(MemoryIds.SLIDE_WINDOW)
export default class SlideWindowMemory extends Memory {
  async summarize(): Promise<Message[]> {
    const messages = this.context;
    const result: Message[] = [];

    if (messages[0]?.role === Role.SYSTEM) {
      result.push(messages[0]);
    }

    for (const msg of messages) {
      if (msg.role === Role.USER && msg.meta?.hidden) {
        result.push(msg);
      }
    }

    const turns: Message[][] = [];
    let currentTurn: Message[] = [];

    for (const msg of messages) {
      if (msg.role === Role.SYSTEM) continue;
      if (msg.role === Role.USER && msg.meta?.hidden) continue;

      currentTurn.push(msg);

      if (msg.role === Role.ASSIST) {
        turns.push(currentTurn);
        currentTurn = [];
      }
    }

    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    const recentTurns = turns.slice(-this.windowSize);
    const truncatedCount = turns.length - recentTurns.length;

    if (truncatedCount > 0) {
      result.push({
        id: generateId('msg'),
        role: Role.USER,
        content: `[Earlier conversation history (${truncatedCount} turns) has been truncated to fit context window]`,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(),
        conversationId: messages[0]?.conversationId ?? '',
      });
    }

    for (const turn of recentTurns) {
      result.push(...turn);
    }

    return result;
  }

  override async *postTurn(
    currentMessage?: Message,
  ): AsyncGenerator<AgentEvent, void, void> {
    if (!currentMessage) return;
    const messages = [...(await this.summarize()), currentMessage];
    yield* this.yieldContextUsage(messages, currentMessage.id);
  }
}
