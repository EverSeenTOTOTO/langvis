import { Message, Role } from '@/shared/entities/Message';
import type { MessageAttachment } from '@/shared/types/entities';
import type { ToolCallRecord } from '@/shared/types/render';
import { inject } from 'tsyringe';
import { service } from '../decorator/service';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from '../modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '../modules/conversation/database/message.repository.port';
import type { ConversationRepositoryPort } from '../modules/conversation/database/conversation.repository.port';

/**
 * ConversationService — 薄 facade。
 *
 * 委托给 MessageRepository 和 ConversationRepository。
 * 外部消费者（ChatService、Controllers）无需改动。
 */
@service()
export class ConversationService {
  constructor(
    @inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
  ) {}

  // ════════════════════════════════════════
  // Message 操作（委托 MessageRepository）
  // ════════════════════════════════════════

  async batchAddMessages(
    conversationId: string,
    messagesData: Array<{
      id?: string;
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ) {
    return this.messageRepo.batchCreate(conversationId, messagesData);
  }

  async findLastAssistantMessage(conversationId: string) {
    return this.messageRepo.findLastAssistantMessage(conversationId);
  }

  async findActiveAssistantMessages(conversationId: string) {
    return this.messageRepo.findActiveAssistantMessages(conversationId);
  }

  async getMessagesByConversationId(conversationId: string) {
    return this.messageRepo.findByConversationId(conversationId);
  }

  async saveMessage(message: Message) {
    return this.messageRepo.save(message);
  }

  async batchDeleteMessagesInConversation(
    conversationId: string,
    messageIds?: string[],
  ) {
    return this.messageRepo.batchDeleteInConversation(
      conversationId,
      messageIds,
    );
  }

  async updateMessage(messageId: string, partial: Partial<Message>) {
    return this.messageRepo.update(messageId, partial);
  }

  async appendToolCallRecord(messageId: string, record: ToolCallRecord) {
    return this.messageRepo.appendToolCallRecord(messageId, record);
  }

  async appendThought(messageId: string, thought: string) {
    return this.messageRepo.appendThought(messageId, thought);
  }

  async deleteMessagesAfter(conversationId: string, afterMessageId: string) {
    return this.messageRepo.deleteAfter(conversationId, afterMessageId);
  }

  // ════════════════════════════════════════
  // Conversation 操作（委托 ConversationRepository）
  // ════════════════════════════════════════

  async createConversation(
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ) {
    return this.convRepo.create(name, userId, config, groupId, groupName);
  }

  async getConversationById(id: string, userId?: string) {
    return this.convRepo.findById(id, userId);
  }

  async updateConversation(
    id: string,
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ) {
    return this.convRepo.update(id, name, userId, config, groupId, groupName);
  }

  async deleteConversation(id: string, userId: string) {
    return this.convRepo.delete(id, userId);
  }
}
