import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { Conversation } from '@/shared/entities/Conversation';
import type { Message } from '@/shared/entities/Message';
import { Role } from '@/shared/entities/Message';
import { makeAutoObservable, reaction } from 'mobx';
import { singleton } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@singleton()
export class ConversationStore {
  @hydrate()
  conversations: Conversation[] = [];

  @hydrate()
  currentConversationId?: Conversation['id'];

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

  async setCurrentConversationId(id: string) {
    this.currentConversationId = id;
  }

  static isTempMessage(msg: Message) {
    return msg.id.startsWith('temp-');
  }

  addTempMessage(conversationId: string, role: Role) {
    if (!this.messages[conversationId]) {
      this.messages[conversationId] = [];
    }

    const tempMessage: Message = {
      id: `temp-${uuidv4()}`,
      content: '',
      role,
      createdAt: new Date(),
      conversationId,
      loading: true,
    };

    this.messages[conversationId].push(tempMessage);
  }

  @api('/api/conversations', { method: 'post' })
  async createConversation(
    _params: { name: string },
    req?: ApiRequest<{ name: string }>,
  ) {
    const result = await req!.send();

    if (result) {
      this.setCurrentConversationId((result as Conversation).id);

      await this.getAllConversations();
    }
  }

  @api('/api/conversations')
  async getAllConversations(_params?: any, req?: ApiRequest) {
    const result = (await req!.send()) as Conversation[];

    if (result) {
      this.conversations = result;

      const found = this.conversations.find(
        c => c.id === this.currentConversationId,
      );

      if (!found || !this.currentConversationId) {
        this.setCurrentConversationId(this.conversations[0]?.id);
      }
    }

    return result;
  }

  @api((req: { id: string }) => `/api/conversations/${req.id}`, {
    method: 'put',
  })
  async updateConversation(
    _params: { id: string; name: string },
    req?: ApiRequest<{ id: string; name: string }>,
  ) {
    const result = (await req!.send()) as Conversation;

    await this.getAllConversations();

    return result;
  }

  @api((req: { id: string }) => `/api/conversations/${req.id}`, {
    method: 'delete',
  })
  async deleteConversation(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ) {
    await req!.send();
    await this.getAllConversations();
  }

  @api((req: { id: string }) => `/api/conversations/${req.id}/messages`, {
    method: 'post',
  })
  async addMessageToConversation(
    params: { id: string; role: Role; content: string },
    req?: ApiRequest<{ conversationId: string; role: Role; content: string }>,
  ) {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  @api((req: { id: string }) => `/api/conversations/${req.id}/messages`)
  async getMessagesByConversationId(
    params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ) {
    const messages = (await req!.send()) as Message[];

    this.messages[params.id] = messages;

    return messages;
  }

  @api((req: { id: string }) => `/api/conversations/${req.id}/messages`, {
    method: 'delete',
  })
  async batchDeleteMessagesInConversation(
    params: { id: string; messageIds: string[] },
    req?: ApiRequest<{ id: string; messageIds: string[] }>,
  ) {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }
}
