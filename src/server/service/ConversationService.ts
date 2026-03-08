import { AgentIds, UNGROUPED_GROUP_NAME } from '@/shared/constants';
import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { Message, MessageEntity, Role } from '@/shared/entities/Message';
import { In } from 'typeorm';
import { service } from '../decorator/service';
import pg from './pg';

@service()
export class ConversationService {
  private async getOrCreateGroupByName(
    groupName: string,
    userId: string,
  ): Promise<string> {
    const groupRepository = pg.getRepository(ConversationGroupEntity);

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

    const conversationRepository = pg.getRepository(ConversationEntity);
    const groupRepository = pg.getRepository(ConversationGroupEntity);

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
    const conversationRepository = pg.getRepository(ConversationEntity);
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
    const conversationRepository = pg.getRepository(ConversationEntity);
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
    const conversationRepository = pg.getRepository(ConversationEntity);
    const messageRepository = pg.getRepository(MessageEntity);

    const conversation = await conversationRepository.findOne({
      where: { id, userId },
      relations: ['messages'],
    });

    if (!conversation) {
      return false;
    }

    if (conversation.messages && conversation.messages.length > 0) {
      await messageRepository.delete({
        conversationId: id,
      });
    }

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
