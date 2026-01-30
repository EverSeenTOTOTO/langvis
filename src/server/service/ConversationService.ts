import { AgentIds } from '@/shared/constants';
import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { Message, MessageEntity, Role } from '@/shared/entities/Message';
import { In } from 'typeorm';
import { service } from '../decorator/service';
import pg from './pg';

@service()
export class ConversationService {
  // private readonly logger = Logger.child({ source: 'ConversationService' });

  async createConversation(
    name: string,
    config?: Record<string, any> | null,
  ): Promise<Conversation> {
    const finalConfig = config ?? {};
    if (!finalConfig.agent) {
      finalConfig.agent = AgentIds.CHAT;
    }

    const conversationRepository = pg.getRepository(ConversationEntity);
    const conversation = conversationRepository.create({
      name,
      config: finalConfig,
    });
    return await conversationRepository.save(conversation);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    return await conversationRepository.findOneBy({ id });
  }

  async getAllConversations(): Promise<Conversation[]> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    return await conversationRepository.find();
  }

  async updateConversation(
    id: string,
    name: string,
    config?: Record<string, any> | null,
  ): Promise<Conversation | null> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    const conversation = await conversationRepository.findOneBy({ id });
    if (!conversation) {
      return null;
    }
    conversation.name = name;
    if (config !== undefined) {
      conversation.config = config ?? null;
    }
    return await conversationRepository.save(conversation);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    const messageRepository = pg.getRepository(MessageEntity);

    // Find the conversation with its messages
    const conversation = await conversationRepository.findOne({
      where: { id },
      relations: ['messages'],
    });

    if (!conversation) {
      return false;
    }

    // Delete all messages associated with the conversation
    if (conversation.messages && conversation.messages.length > 0) {
      await messageRepository.delete({
        conversationId: id,
      });
    }

    // Delete the conversation itself
    await conversationRepository.delete(id);
    return true;
  }

  async batchAddMessages(
    conversationId: string,
    messagesData: Array<{
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ): Promise<Message[]> {
    const conversation = await this.getConversationById(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const messageRepository = pg.getRepository(MessageEntity);
    const messages = messagesData.map(data =>
      messageRepository.create({
        conversationId,
        role: data.role,
        content: data.content,
        meta: data.meta,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }),
    );

    return await messageRepository.save(messages);
  }

  async getMessagesByConversationId(
    conversationId: string,
  ): Promise<Message[]> {
    const messageRepository = pg.getRepository(MessageEntity);
    return await messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async batchDeleteMessagesInConversation(
    conversationId: string,
    messageIds?: string[],
  ) {
    const messageRepository = pg.getRepository(MessageEntity);

    if (!messageIds || messageIds.length === 0) {
      return await messageRepository.delete({ conversationId });
    }

    return await messageRepository.delete({
      conversationId,
      id: In(messageIds),
    });
  }

  async updateMessage(
    messageId: string,
    content: string,
    meta?: Record<string, any> | null,
  ): Promise<Message | null> {
    const messageRepository = pg.getRepository(MessageEntity);
    const message = await messageRepository.findOneBy({ id: messageId });

    if (!message) {
      return null;
    }

    message.content = content;
    if (meta !== undefined) {
      message.meta = meta;
    }
    return await messageRepository.save(message);
  }

  /**
   * Delete all messages after a specific message (for rollback operations)
   */
  async deleteMessagesAfter(
    conversationId: string,
    afterMessageId: string,
  ): Promise<boolean> {
    const messageRepository = pg.getRepository(MessageEntity);

    // Get the target message to get its timestamp
    const targetMessage = await messageRepository.findOneBy({
      id: afterMessageId,
      conversationId,
    });

    if (!targetMessage) {
      return false;
    }

    // Delete all messages created after the target message
    await messageRepository
      .createQueryBuilder()
      .delete()
      .from(MessageEntity)
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('createdAt > :createdAt', {
        createdAt: targetMessage.createdAt,
      })
      .execute();

    return true;
  }
}
