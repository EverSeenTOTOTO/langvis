import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { Conversation } from '@/shared/entities/Conversation';
import { Message, Role } from '@/shared/entities/Message';
import { makeAutoObservable, reaction } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { ChatStore } from './chat';
import { message } from 'antd';
import { SSEMessage } from '@/shared/types';
import { SettingStore } from './setting';

@singleton()
export class ConversationStore {
  @hydrate()
  conversations: Conversation[] = [];

  @hydrate()
  currentConversationId?: Conversation['id'];

  @hydrate()
  messages: Record<string, Message[]> = {};

  constructor(
    @inject(ChatStore) private chatStore: ChatStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
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

  async handleUserMessage(content: string) {
    const id = this.currentConversationId;

    if (!id) {
      message.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

    this.addTempMessage(id, Role.USER);

    await this.addMessageToConversation({
      id,
      role: Role.USER,
      content,
    });

    this.addTempMessage(id, Role.ASSIST);

    if (!this.chatStore.isConnected(id)) {
      await this.chatStore
        .connectToSSE(id, msg => {
          if (id !== this.currentConversationId) {
            console.warn(
              `Abort SSE message for non-current conversation: ${id}, current: ${this.currentConversationId}`,
            );
            return;
          }
          this.handleSSEMessage(id, msg);
        })
        .catch(e => {
          console.error(e);
          message.error(
            `${this.settingStore.tr('Failed to connect to SSE')}: ${(e as Error)?.message}`,
          );
        });
    }
  }

  private handleSSEMessage(conversationId: string, msg: SSEMessage) {
    switch (msg.type) {
      case 'reply': {
        const lastMessage = this.messages[conversationId].slice(-1)[0];

        if (
          lastMessage?.role !== Role.ASSIST ||
          !ConversationStore.isTempMessage(lastMessage)
        ) {
          message.error(
            this.settingStore.tr(
              'Received sse message for non-pending conversation',
            ),
          );
          return;
        }

        lastMessage.loading = false;
        lastMessage.content += msg.content;
        break;
      }
      default:
        break;
    }
  }

  private addTempMessage(conversationId: string, role: Role) {
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
