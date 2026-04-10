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
    if (messages[messages.length - 2]?.role === Role.USER) {
      result.push(messages[messages.length - 2]);
    }

    return result;
  }
}
