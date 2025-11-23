import { singleton } from 'tsyringe';
import pg from './pg';
import {
  ConversationEntity,
  Conversation,
} from '@/shared/entities/Conversation';
import { MessageEntity, Message, Role } from '@/shared/entities/Message';
import { In } from 'typeorm';
import { AgentMetas } from '@/shared/constants';

@singleton()
export class ConversationService {
  async createConversation(
    name: string,
    config?: Record<string, any> | null,
  ): Promise<Conversation> {
    const finalConfig = config ?? {};
    if (!finalConfig.agent) {
      finalConfig.agent = AgentMetas.REACT_AGENT.Name.en;
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
  async addMessageToConversation(
    conversationId: string,
    role: Role,
    content: string,
  ): Promise<Message | null> {
    const conversation = await this.getConversationById(conversationId);

    if (!conversation) {
      return null;
    }

    const messageRepository = pg.getRepository(MessageEntity);
    const message = messageRepository.create({
      conversationId,
      role,
      content,
    });

    return await messageRepository.save(message);
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
    messageIds: string[],
  ) {
    const messageRepository = pg.getRepository(MessageEntity);

    return await messageRepository.delete({
      conversationId,
      id: In(messageIds),
    });
  }

  async updateMessage(
    messageId: string,
    content: string,
  ): Promise<Message | null> {
    const messageRepository = pg.getRepository(MessageEntity);
    const message = await messageRepository.findOneBy({ id: messageId });

    if (!message) {
      return null;
    }

    message.content = content;
    return await messageRepository.save(message);
  }
}
