import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { store } from '@/client/decorator/store';
import type {
  DeleteConversationGroupRequest,
  GetAllConversationGroupsResponse,
  ReorderConversationsInGroupRequest,
  ReorderItemsRequest,
  UpdateConversationGroupRequest,
} from '@/shared/dto/controller';
import { UNGROUPED_GROUP_NAME } from '@/shared/constants';
import type { ConversationGroup } from '@/shared/types/entities';
import { makeAutoObservable } from 'mobx';

@store()
export class ConversationGroupStore {
  @hydrate()
  groups: ConversationGroup[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  get sortedGroups(): ConversationGroup[] {
    return [...this.groups].sort((a, b) => {
      const aIsUngrouped = a.name === UNGROUPED_GROUP_NAME;
      const bIsUngrouped = b.name === UNGROUPED_GROUP_NAME;
      if (aIsUngrouped && !bIsUngrouped) return -1;
      if (!aIsUngrouped && bIsUngrouped) return 1;
      return a.order - b.order;
    });
  }

  findGroupIdByConversationId(conversationId: string): string | undefined {
    for (const group of this.groups) {
      if (group.conversations?.some(c => c.id === conversationId)) {
        return group.id;
      }
    }
    return undefined;
  }

  @api('/api/conversation-group')
  async getAllGroups(
    _params?: unknown,
    req?: ApiRequest,
  ): Promise<GetAllConversationGroupsResponse | undefined> {
    const result = (await req!.send()) as GetAllConversationGroupsResponse;
    if (!result) return;

    this.groups = result.groups.map(g => ({
      ...g,
      userId: '',
      createdAt: new Date(),
      conversations: g.conversations || [],
    }));

    return result;
  }

  @api(
    (req: UpdateConversationGroupRequest) =>
      `/api/conversation-group/${req.id}`,
    {
      method: 'put',
    },
  )
  async updateGroup(
    _params: UpdateConversationGroupRequest,
    req?: ApiRequest<UpdateConversationGroupRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getAllGroups();
  }

  @api(
    (req: DeleteConversationGroupRequest) =>
      `/api/conversation-group/${req.id}`,
    {
      method: 'delete',
    },
  )
  async deleteGroup(
    _params: DeleteConversationGroupRequest,
    req?: ApiRequest<DeleteConversationGroupRequest>,
  ): Promise<{ deletedConversationIds: string[] } | undefined> {
    const result = await req!.send();
    await this.getAllGroups();
    return result as { deletedConversationIds: string[] };
  }

  @api('/api/conversation-group/reorder', { method: 'post' })
  async reorderItems(
    _params: ReorderItemsRequest,
    req?: ApiRequest<ReorderItemsRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getAllGroups();
  }

  @api('/api/conversation-group/reorder-conversations', { method: 'post' })
  async reorderConversationsInGroup(
    _params: ReorderConversationsInGroupRequest,
    req?: ApiRequest<ReorderConversationsInGroupRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getAllGroups();
  }
}
