import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { UNGROUPED_GROUP_NAME } from '@/shared/constants';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { inject, singleton } from 'tsyringe';

@singleton()
export class ConversationRepository implements ConversationRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  // ════════════════════════════════════════
  // Conversation CRUD
  // ════════════════════════════════════════

  async create(
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation> {
    const finalConfig = config ?? {};

    const conversationRepository = this.db.getRepository(ConversationEntity);

    const resolvedGroupId = groupId
      ? groupId
      : await this.getOrCreateGroupByName(
          groupName ?? UNGROUPED_GROUP_NAME,
          userId,
        );

    const groupRepository = this.db.getRepository(ConversationGroupEntity);
    const group = await groupRepository.findOneBy({
      id: resolvedGroupId,
      userId,
    });
    if (!group) {
      throw new Error('Group not found');
    }

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

  async findById(id: string, userId?: string): Promise<Conversation | null> {
    const conversationRepository = this.db.getRepository(ConversationEntity);
    const where: Record<string, any> = { id };
    if (userId) {
      where.userId = userId;
    }
    return await conversationRepository.findOneBy(where);
  }

  async update(
    id: string,
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation | null> {
    const conversationRepository = this.db.getRepository(ConversationEntity);
    const conversation = await conversationRepository.findOneBy({ id, userId });
    if (!conversation) return null;

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

  async delete(id: string, userId: string): Promise<boolean> {
    const conversationRepository = this.db.getRepository(ConversationEntity);
    const result = await conversationRepository.delete({ id, userId });
    return result.affected ? result.affected > 0 : false;
  }

  // ════════════════════════════════════════
  // Conversation Group CRUD
  // ════════════════════════════════════════

  async createGroup(name: string, userId: string) {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

    const maxOrder = await groupRepository
      .createQueryBuilder('group')
      .where('group.userId = :userId', { userId })
      .select('MAX("order")', 'max')
      .getRawOne();

    const order = (maxOrder?.max ?? -100) + 100;

    const group = groupRepository.create({ name, userId, order });
    return await groupRepository.save(group);
  }

  async findGroupsByUserId(userId: string) {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

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

  async updateGroup(id: string, name: string, userId: string) {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);
    const group = await groupRepository.findOneBy({ id, userId });
    if (!group) return null;

    group.name = name;
    return await groupRepository.save(group);
  }

  async deleteGroup(id: string, userId: string) {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

    const group = await groupRepository.findOne({
      where: { id, userId },
      relations: ['conversations'],
    });

    if (!group) {
      return { success: false, deletedConversationIds: [] };
    }

    const conversationIds = group.conversations?.map(c => c.id) ?? [];
    await groupRepository.delete(id);

    return { success: true, deletedConversationIds: conversationIds };
  }

  async reorderGroups(
    items: Array<{ id: string; type: 'group'; order: number }>,
    userId: string,
  ): Promise<void> {
    const groupRepository = this.db.getRepository(ConversationGroupEntity);

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
    const groupRepository = this.db.getRepository(ConversationGroupEntity);
    const group = await groupRepository.findOneBy({ id: groupId, userId });
    if (!group) {
      throw new Error('Group not found');
    }

    const conversationRepository = this.db.getRepository(ConversationEntity);
    for (const item of items) {
      await conversationRepository.update(
        { id: item.id, groupId, userId },
        { order: item.order },
      );
    }
  }

  // ── 内部 ──

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

    const newGroup = groupRepository.create({ name: groupName, userId, order });
    const savedGroup = await groupRepository.save(newGroup);
    return savedGroup.id;
  }
}
