import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import { Memory } from '..';

@memory(MemoryIds.CHAT_HISTORY)
export default class ChatHistoryMemory extends Memory {
  async summarize(): Promise<Message[]> {
    const messages = this.getContext();

    // Strip trailing assistant placeholder (streaming in-progress)
    if (messages[messages.length - 1]?.role === Role.ASSIST) {
      return messages.slice(0, -1);
    }

    return messages;
  }
}
