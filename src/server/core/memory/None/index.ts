import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import ChatHistoryMemory from '../ChatHistory';

@memory(MemoryIds.NONE)
export default class NoneMemory extends ChatHistoryMemory {
  async summarize(): Promise<Message[]> {
    const messages = await this.retrieve();

    const result: Message[] = [];

    if (messages[0]?.role === Role.SYSTEM) {
      result.push(messages[0]);
    }
    if (messages[messages.length - 2]?.role === Role.USER) {
      // messages[len-1] is the streaming assist message
      result.push(messages[messages.length - 2]);
    }

    return result;
  }
}
