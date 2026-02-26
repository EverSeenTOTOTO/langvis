import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { ConversationEntity } from '@/shared/entities/Conversation';
import { In } from 'typeorm';
import { service } from '../decorator/service';
import pg from './pg';

@service()
export class ConversationGroupService {
  async createGroup(
    name: string,
    userId: string,
  ): Promise<ConversationGroupEntity> {
    const groupRepository = pg.getRepository(ConversationGroupEntity);

    // Get max order for the user's groups
    const maxOrder = await groupRepository
      .createQueryBuilder('group')
      .where('group.userId = :userId', { userId })
      .select('MAX("order")', 'max')
      .getRawOne();

    const order = (maxOrder?.max ?? -100) + 100;

    const group = groupRepository.create({
      name,
      userId,
      order,
    });

    return await groupRepository.save(group);
  }

  async getGroupsByUserId(userId: string) {
    const groupRepository = pg.getRepository(ConversationGroupEntity);

    // Get all groups for user with their conversations
    const groups = await groupRepository.find({
      where: { userId },
      order: { order: 'ASC' },
      relations: ['conversations'],
    });

    return {
      groups: groups.map(g => ({
        id: g.id,
        name: g.name,
        order: g.order,
        conversations: g.conversations?.sort((a, b) => a.order - b.order) ?? [],
      })),
    };
  }

  async updateGroup(
    id: string,
    name: string,
    userId: string,
  ): Promise<ConversationGroupEntity | null> {
    const groupRepository = pg.getRepository(ConversationGroupEntity);
    const group = await groupRepository.findOneBy({ id, userId });

    if (!group) {
      return null;
    }

    group.name = name;
    return await groupRepository.save(group);
  }

  async deleteGroup(
    id: string,
    userId: string,
  ): Promise<{ success: boolean; deletedConversationIds: string[] }> {
    const groupRepository = pg.getRepository(ConversationGroupEntity);
    const conversationRepository = pg.getRepository(ConversationEntity);
    const messageRepository = pg.getRepository('MessageEntity');

    const group = await groupRepository.findOne({
      where: { id, userId },
      relations: ['conversations'],
    });

    if (!group) {
      return { success: false, deletedConversationIds: [] };
    }

    const conversationIds = group.conversations?.map(c => c.id) ?? [];

    // Delete all messages in conversations
    if (conversationIds.length > 0) {
      await messageRepository.delete({
        conversationId: In(conversationIds),
      });

      // Delete all conversations in the group
      await conversationRepository.delete({
        groupId: id,
      });
    }

    // Delete the group
    await groupRepository.delete(id);

    return { success: true, deletedConversationIds: conversationIds };
  }

  async reorderItems(
    items: Array<{ id: string; type: 'group'; order: number }>,
    userId: string,
  ): Promise<void> {
    const groupRepository = pg.getRepository(ConversationGroupEntity);

    for (const item of items) {
      await groupRepository.update(
        { id: item.id, userId },
        { order: item.order },
      );
    }
  }

  async reorderConversationsInGroup(
    groupId: string,
    items: Array<{ id: string; order: number }>,
    userId: string,
  ): Promise<void> {
    const conversationRepository = pg.getRepository(ConversationEntity);

    // Verify the group belongs to the user
    const groupRepository = pg.getRepository(ConversationGroupEntity);
    const group = await groupRepository.findOneBy({ id: groupId, userId });

    if (!group) {
      throw new Error('Group not found');
    }

    for (const item of items) {
      await conversationRepository.update(
        { id: item.id, groupId, userId },
        { order: item.order },
      );
    }
  }
}
