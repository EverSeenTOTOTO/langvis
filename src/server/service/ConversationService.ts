import { AgentIds, UNGROUPED_GROUP_NAME } from '@/shared/constants';
import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { Message, MessageEntity, Role } from '@/shared/entities/Message';
import type { MessageAttachment } from '@/shared/types/entities';
import { inject } from 'tsyringe';
import { In } from 'typeorm';
import { service } from '../decorator/service';
import { DatabaseService } from './DatabaseService';

const TERMINAL_EVENT_TYPES = new Set(['final', 'cancelled', 'error']);

@service()
export class ConversationService {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  private async getOrCreateGroupByName(
    groupName: string,
    userId: string,
  ): Promise<string> {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

    const existingGroup = await groupRepository.findOneBy({
      name: groupName,
      userId,
    });

    if (existingGroup) {
      return existingGroup.id;
    }

    const maxOrder = await groupRepository
      .createQueryBuilder('group')
      .where('group.userId = :userId', { userId })
      .select('MAX("order")', 'max')
      .getRawOne();

    const order = (maxOrder?.max ?? -100) + 100;

    const newGroup = groupRepository.create({
      name: groupName,
      userId,
      order,
    });
    const savedGroup = await groupRepository.save(newGroup);
    return savedGroup.id;
  }

  async createConversation(
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation> {
    const finalConfig = config ?? {};
    if (!finalConfig.agent) {
      finalConfig.agent = AgentIds.CHAT;
    }

    const conversationRepository = this.db.getRepository(ConversationEntity);
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

    let resolvedGroupId = groupId;

    // If no groupId, find or create group by name (default to ungrouped)
    if (!resolvedGroupId) {
      resolvedGroupId = await this.getOrCreateGroupByName(
        groupName ?? UNGROUPED_GROUP_NAME,
        userId,
      );
    }

    // Verify group exists and belongs to user
    const group = await groupRepository.findOneBy({
      id: resolvedGroupId,
      userId,
    });
    if (!group) {
      throw new Error('Group not found');
    }

    // Get max order for conversations in this group
    const maxOrder = await conversationRepository
      .createQueryBuilder('conversation')
      .where('conversation.groupId = :groupId', { groupId: resolvedGroupId })
      .select('MAX("order")', 'max')
      .getRawOne();

    const order = (maxOrder?.max ?? -100) + 100;

    const conversation = conversationRepository.create({
      name,
      config: finalConfig,
      userId,
      groupId: resolvedGroupId,
      order,
    });
    return await conversationRepository.save(conversation);
  }

  async getConversationById(
    id: string,
    userId?: string,
  ): Promise<Conversation | null> {
    const conversationRepository = this.db.getRepository(ConversationEntity);
    const where: Record<string, any> = { id };
    if (userId) {
      where.userId = userId;
    }
    return await conversationRepository.findOneBy(where);
  }

  async updateConversation(
    id: string,
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation | null> {
    const conversationRepository = this.db.getRepository(ConversationEntity);
    const conversation = await conversationRepository.findOneBy({ id, userId });
    if (!conversation) {
      return null;
    }
    conversation.name = name;
    if (config !== undefined) {
      conversation.config = config ?? null;
    }
    if (groupId !== undefined || groupName !== undefined) {
      const resolvedGroupId = groupId
        ? groupId
        : await this.getOrCreateGroupByName(
            groupName ?? UNGROUPED_GROUP_NAME,
            userId,
          );
      conversation.groupId = resolvedGroupId;
    }
    return await conversationRepository.save(conversation);
  }

  async deleteConversation(id: string, userId: string): Promise<boolean> {
    const conversationRepository = this.db.getRepository(ConversationEntity);

    const result = await conversationRepository.delete({ id, userId });

    return result.affected ? result.affected > 0 : false;
  }

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
  ): Promise<Message[]> {
    const conversation = await this.getConversationById(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const messageRepository = this.db.getRepository(MessageEntity);
    const messages = messagesData.map(data =>
      messageRepository.create({
        ...(data.id && { id: data.id }),
        conversationId,
        role: data.role,
        content: data.content,
        attachments: data.attachments,
        meta: data.meta,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }),
    );

    return await messageRepository.save(messages);
  }

  async findLastAssistantMessage(
    conversationId: string,
  ): Promise<Message | null> {
    const messageRepository = this.db.getRepository(MessageEntity);
    return await messageRepository.findOne({
      where: { conversationId, role: Role.ASSIST },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find all assistant messages without terminal events (final/cancelled/error).
   * Used for zombie detection after server restart.
   */
  async findNonTerminalAssistantMessages(
    conversationId: string,
  ): Promise<Message[]> {
    const messageRepository = this.db.getRepository(MessageEntity);
    const messages = await messageRepository.find({
      where: { conversationId, role: Role.ASSIST },
      order: { createdAt: 'ASC' },
    });

    return messages.filter(msg => {
      const events = msg.meta?.events;
      if (!Array.isArray(events) || events.length === 0) return true;
      return !events.some(e => TERMINAL_EVENT_TYPES.has(e.type));
    });
  }

  async getMessagesByConversationId(
    conversationId: string,
  ): Promise<Message[]> {
    const messageRepository = this.db.getRepository(MessageEntity);
    return await messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Save (upsert) a message. If the message ID exists, updates it; otherwise inserts.
   */
  async saveMessage(message: Message): Promise<Message> {
    const messageRepository = this.db.getRepository(MessageEntity);
    return await messageRepository.save(message as MessageEntity);
  }

  async batchDeleteMessagesInConversation(
    conversationId: string,
    messageIds?: string[],
  ) {
    const messageRepository = this.db.getRepository(MessageEntity);

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
    const messageRepository = this.db.getRepository(MessageEntity);
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
    const messageRepository = this.db.getRepository(MessageEntity);

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
