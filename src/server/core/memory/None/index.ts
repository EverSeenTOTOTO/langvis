import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import { Memory } from '..';

@memory(MemoryIds.NONE)
export default class NoneMemory extends Memory {
  async summarize(): Promise<Message[]> {
    const messages = this.getContext();

    const result: Message[] = [];

    if (messages[0]?.role === Role.SYSTEM) {
      result.push(messages[0]);
    }

    // Include hidden user messages (session context)
    // These are current-turn context, not conversation history
    for (const msg of messages) {
      if (msg.role === Role.USER && msg.meta?.hidden) {
        result.push(msg);
      }
    }

    // Include last non-hidden user message
    const lastUserMsg = [...messages]
      .reverse()
      .find(m => m.role === Role.USER && !m.meta?.hidden);
    if (lastUserMsg) {
      result.push(lastUserMsg);
    }

    return result;
  }
}
