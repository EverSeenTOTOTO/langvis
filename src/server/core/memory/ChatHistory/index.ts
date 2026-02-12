import { memory } from '@/server/decorator/core';
import { ConversationService } from '@/server/service/ConversationService';
import { Logger } from '@/server/utils/logger';
import { MemoryIds } from '@/shared/constants';
import { Role } from '@/shared/types/entities';
import { inject } from 'tsyringe';
import { Memory } from '..';

@memory(MemoryIds.CHAT_HISTORY)
export default class ChatHistoryMemory extends Memory {
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
    return this.conversationService.getMessagesByConversationId(
      this.conversationId!,
    );
  }

  async clearByConversationId() {
    await this.conversationService.batchDeleteMessagesInConversation(
      this.conversationId!,
    );
  }

  async clearByUserId(_userId: string) {
    throw new Error('ChatHistoryMemory does not support clearByUserId');
  }

  async summarize() {
    const result = await this.conversationService.getMessagesByConversationId(
      this.conversationId!,
    );

    if (result[result.length - 1]?.role === Role.ASSIST) {
      // messages[len-1] is the streaming assist message
      result.splice(result.length - 1, 1);
    }

    return result;
  }
}
