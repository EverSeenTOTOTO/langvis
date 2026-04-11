import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { generateId } from '@/shared/utils';
import { Message, Role } from '@/shared/types/entities';
import { Memory } from '..';

@memory(MemoryIds.SLIDE_WINDOW)
export default class SlideWindowMemory extends Memory {
  async summarize(): Promise<Message[]> {
    const messages = this.getContext();
    const result: Message[] = [];

    // Always include system message (first message if it's system role)
    if (messages[0]?.role === Role.SYSTEM) {
      result.push(messages[0]);
    }

    // Include hidden user messages (session context) - current-turn context
    for (const msg of messages) {
      if (msg.role === Role.USER && msg.meta?.hidden) {
        result.push(msg);
      }
    }

    // Collect conversation turns (pairs of user + assistant)
    const turns: Message[][] = [];
    let currentTurn: Message[] = [];

    for (const msg of messages) {
      // Skip system message and hidden messages (already handled)
      if (msg.role === Role.SYSTEM) continue;
      if (msg.role === Role.USER && msg.meta?.hidden) continue;

      currentTurn.push(msg);

      // A turn ends with assistant message
      if (msg.role === Role.ASSIST) {
        turns.push(currentTurn);
        currentTurn = [];
      }
    }

    // Handle incomplete turn (user message without assistant reply)
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    // Keep only last windowSize turns
    const recentTurns = turns.slice(-this.windowSize);
    const truncatedCount = turns.length - recentTurns.length;

    // Add truncation notice if any turns were dropped
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

    // Flatten turns back to messages
    for (const turn of recentTurns) {
      result.push(...turn);
    }

    return result;
  }
}
