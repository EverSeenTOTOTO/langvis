import { memory } from '@/server/decorator/core';
import { ConversationService } from '@/server/service/ConversationService';
import { Logger } from '@/server/utils/logger';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import { inject } from 'tsyringe';
import { Memory } from '..';

@memory(MemoryIds.NONE)
export default class NoneMemory extends Memory {
  protected readonly logger!: Logger;
  conversationId?: string;
  userId?: string;

  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {
    super();
  }

  async store(
    messages: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }[],
  ) {
    await this.conversationService.batchAddMessages(
      this.conversationId!,
      messages,
    );
  }

  async retrieve() {
    return await this.conversationService.getMessagesByConversationId(
      this.conversationId!,
    );
  }

  async clearByConversationId() {
    await this.conversationService.batchDeleteMessagesInConversation(
      this.conversationId!,
    );
  }

  async clearByUserId(_userId: string) {
    throw new Error('NoneMemory does not support clearByUserId');
  }

  async summarize() {
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
