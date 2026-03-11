import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { store } from '@/client/decorator/store';
import type {
  AddMessageToConversationRequest,
  BatchDeleteMessagesInConversationRequest,
  CreateConversationRequest,
  UpdateConversationRequest,
} from '@/shared/dto/controller';
import type { Conversation, Message } from '@/shared/types/entities';
import { makeAutoObservable } from 'mobx';
import { inject } from 'tsyringe';
import { ConversationGroupStore } from './conversationGroup';

@store()
export class ConversationStore {
  currentConversationId?: string;

  @hydrate()
  messages: Record<string, Message[]> = {};

  constructor(
    @inject(ConversationGroupStore)
    private conversationGroupStore: ConversationGroupStore,
  ) {
    makeAutoObservable(this);
  }

  getFirstConversationId(): string | undefined {
    for (const group of this.conversationGroupStore.sortedGroups) {
      if (group.conversations && group.conversations.length > 0) {
        const sortedConversations = [...group.conversations].sort(
          (a, b) => a.order - b.order,
        );
        return sortedConversations[0].id;
      }
    }
    return undefined;
  }

  findConversationById(id: string): Conversation | undefined {
    for (const group of this.conversationGroupStore.groups) {
      const found = group.conversations?.find(c => c.id === id);
      if (found) return found;
    }
    return undefined;
  }

  get currentConversation(): Conversation | undefined {
    if (!this.currentConversationId) return undefined;
    return this.findConversationById(this.currentConversationId);
  }

  get currentMessages(): Message[] {
    return this.messages[this.currentConversationId!] ?? [];
  }

  @api('/api/conversation', { method: 'post' })
  async createConversation(
    _params: CreateConversationRequest,
    req?: ApiRequest<CreateConversationRequest>,
  ): Promise<Conversation | undefined> {
    const result = await req!.send();
    if (result) {
      await this.conversationGroupStore.getAllGroups();
      return result as Conversation;
    }
    return undefined;
  }

  @api('/api/conversation/:id', {
    method: 'put',
  })
  async updateConversation(
    _params: UpdateConversationRequest,
    req?: ApiRequest<UpdateConversationRequest>,
  ): Promise<Conversation | undefined> {
    const result = await req!.send();
    await this.conversationGroupStore.getAllGroups();
    return result as Conversation;
  }

  @api('/api/conversation/:id', {
    method: 'delete',
  })
  async deleteConversation(
    params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<void> {
    // Clear current ID first to prevent reaction from querying deleted conversation
    const wasCurrent = this.currentConversationId === params.id;
    if (wasCurrent) {
      this.currentConversationId = undefined;
    }

    await req!.send();
    await this.conversationGroupStore.getAllGroups();

    if (wasCurrent) {
      this.currentConversationId = this.getFirstConversationId();
    }
  }

  @api('/api/conversation/:id/messages', {
    method: 'post',
  })
  async addMessageToConversation(
    params: AddMessageToConversationRequest,
    req?: ApiRequest<AddMessageToConversationRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  @api('/api/conversation/:id/messages')
  async getMessagesByConversationId(
    params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<Message[] | undefined> {
    const messages = await req!.send();
    this.messages[params.id] = messages;
    return messages;
  }

  @api('/api/conversation/:id/messages', { method: 'delete' })
  async batchDeleteMessagesInConversation(
    params: BatchDeleteMessagesInConversationRequest,
    req?: ApiRequest<BatchDeleteMessagesInConversationRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }
}
