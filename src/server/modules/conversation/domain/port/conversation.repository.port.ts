import type { Conversation } from '@/shared/types/entities';
import type { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';

export interface ConversationRepositoryPort {
  create(
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation>;

  findById(id: string, userId?: string): Promise<Conversation | null>;

  update(
    id: string,
    name: string,
    userId: string,
    config?: Record<string, any> | null,
    groupId?: string | null,
    groupName?: string,
  ): Promise<Conversation | null>;

  delete(id: string, userId: string): Promise<boolean>;

  createGroup(name: string, userId: string): Promise<ConversationGroupEntity>;

  findGroupsByUserId(userId: string): Promise<{
    groups: Array<{
      id: string;
      name: string;
      order: number;
      conversations: Conversation[];
    }>;
  }>;

  updateGroup(
    id: string,
    name: string,
    userId: string,
  ): Promise<ConversationGroupEntity | null>;

  deleteGroup(
    id: string,
    userId: string,
  ): Promise<{ success: boolean; deletedConversationIds: string[] }>;

  reorderGroups(
    items: Array<{ id: string; type: 'group'; order: number }>,
    userId: string,
  ): Promise<void>;

  reorderConversationsInGroup(
    groupId: string,
    items: Array<{ id: string; order: number }>,
    userId: string,
  ): Promise<void>;
}
