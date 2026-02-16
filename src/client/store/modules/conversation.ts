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
import { makeAutoObservable, reaction } from 'mobx';

@store()
export class ConversationStore {
  @hydrate()
  conversations: Conversation[] = [];

  @hydrate()
  currentConversationId?: string;

  @hydrate()
  messages: Record<string, Message[]> = {};

  constructor() {
    makeAutoObservable(this);

    reaction(
      () => this.currentConversationId,
      id => {
        if (id) {
          this.getMessagesByConversationId({ id });
        }
      },
    );
  }

  setCurrentConversationId(id: string): void {
    this.currentConversationId = id;
  }

  get currentConversation(): Conversation | undefined {
    return this.conversations.find(
      each => each.id === this.currentConversationId,
    );
  }

  get currentMessages(): Message[] {
    return this.messages[this.currentConversationId!] ?? [];
  }

  @api('/api/conversation', { method: 'post' })
  async createConversation(
    _params: CreateConversationRequest,
    req?: ApiRequest<CreateConversationRequest>,
  ): Promise<void> {
    const result = await req!.send();
    if (result) {
      this.setCurrentConversationId((result as Conversation).id);
      await this.getAllConversations();
    }
  }

  @api('/api/conversation')
  async getAllConversations(
    _params?: unknown,
    req?: ApiRequest,
  ): Promise<Conversation[] | undefined> {
    const result = (await req!.send()) as Conversation[];
    if (!result) return;

    this.conversations = result;

    if (!this.conversations.find(c => c.id === this.currentConversationId)) {
      this.setCurrentConversationId(this.conversations[0]?.id);
    }

    return result;
  }

  @api((req: UpdateConversationRequest) => `/api/conversation/${req.id}`, {
    method: 'put',
  })
  async updateConversation(
    _params: UpdateConversationRequest,
    req?: ApiRequest<UpdateConversationRequest>,
  ): Promise<Conversation | undefined> {
    const result = await req!.send();
    await this.getAllConversations();
    return result as Conversation;
  }

  @api((req: { id: string }) => `/api/conversation/${req.id}`, {
    method: 'delete',
  })
  async deleteConversation(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<void> {
    await req!.send();
    await this.getAllConversations();
  }

  @api(
    (req: AddMessageToConversationRequest) =>
      `/api/conversation/${req.id}/messages`,
    {
      method: 'post',
    },
  )
  async addMessageToConversation(
    params: AddMessageToConversationRequest,
    req?: ApiRequest<AddMessageToConversationRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  @api((req: { id: string }) => `/api/conversation/${req.id}/messages`)
  async getMessagesByConversationId(
    params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<Message[] | undefined> {
    const messages = await req!.send();
    this.messages[params.id] = messages;
    return messages;
  }

  @api(
    (req: BatchDeleteMessagesInConversationRequest) =>
      `/api/conversation/${req.id}/messages`,
    { method: 'delete' },
  )
  async batchDeleteMessagesInConversation(
    params: BatchDeleteMessagesInConversationRequest,
    req?: ApiRequest<BatchDeleteMessagesInConversationRequest>,
  ): Promise<void> {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }
}
