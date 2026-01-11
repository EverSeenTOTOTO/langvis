import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { store } from '@/client/decorator/store';
import {
  AddMessageToConversationRequestDto,
  BatchDeleteMessagesInConversationRequestDto,
  ConversationDto,
  CreateConversationRequestDto,
  MessageDto,
  UpdateConversationRequestDto,
} from '@/shared/dto/controller';
import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { makeAutoObservable, reaction } from 'mobx';

const isActiveAssistMessage = (message?: Message) =>
  message &&
  message.role === Role.ASSIST &&
  (message.meta?.streaming || message.meta?.loading);

@store()
export class ConversationStore {
  @hydrate()
  conversations: ConversationDto[] = [];

  @hydrate()
  currentConversationId?: string;

  @hydrate()
  messages: Record<string, MessageDto[]> = {};

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

  get currentConversation(): ConversationDto | undefined {
    return this.conversations.find(
      each => each.id === this.currentConversationId,
    );
  }

  @api('/api/conversation', { method: 'post' })
  async createConversation(
    _params: CreateConversationRequestDto,
    req?: ApiRequest<CreateConversationRequestDto>,
  ) {
    const result = await req!.send();

    if (result) {
      this.setCurrentConversationId((result as ConversationDto).id);

      await this.getAllConversations();
    }
  }

  @api('/api/conversation')
  async getAllConversations(_params?: any, req?: ApiRequest) {
    const result = (await req!.send()) as ConversationDto[];

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

  @api((req: UpdateConversationRequestDto) => `/api/conversation/${req.id}`, {
    method: 'put',
  })
  async updateConversation(
    _params: UpdateConversationRequestDto,
    req?: ApiRequest<UpdateConversationRequestDto>,
  ) {
    const result = (await req!.send()) as ConversationDto;

    await this.getAllConversations();

    return result;
  }

  @api((req: { id: string }) => `/api/conversation/${req.id}`, {
    method: 'delete',
  })
  async deleteConversation(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ) {
    await req!.send();
    await this.getAllConversations();
  }

  @api(
    (req: AddMessageToConversationRequestDto) =>
      `/api/conversation/${req.id}/messages`,
    {
      method: 'post',
    },
  )
  async addMessageToConversation(
    params: AddMessageToConversationRequestDto,
    req?: ApiRequest<AddMessageToConversationRequestDto>,
  ) {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  @api((req: { id: string }) => `/api/conversation/${req.id}/messages`)
  async getMessagesByConversationId(
    params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ) {
    const messages = await req!.send();

    this.messages[params.id] = messages;

    return messages;
  }

  @api(
    (req: BatchDeleteMessagesInConversationRequestDto) =>
      `/api/conversation/${req.id}/messages`,
    {
      method: 'delete',
    },
  )
  async batchDeleteMessagesInConversation(
    params: BatchDeleteMessagesInConversationRequestDto,
    req?: ApiRequest<BatchDeleteMessagesInConversationRequestDto>,
  ) {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  get currentMessages(): MessageDto[] {
    return this.messages[this.currentConversationId!] || [];
  }

  get activeAssistMessage() {
    const lastMessage = this.currentMessages?.[this.currentMessages.length - 1];

    if (!isActiveAssistMessage(lastMessage)) return;

    return lastMessage;
  }

  updateStreamingMessage(
    conversationId: string,
    deltaContent?: string,
    meta?: Record<string, any>,
  ) {
    const messages = this.messages[conversationId];

    if (!messages) return;

    const lastMessage = messages[messages.length - 1];

    if (!isActiveAssistMessage(lastMessage)) return;

    messages[messages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + (deltaContent ?? ''),
      meta: meta ?? lastMessage.meta,
    };
  }
}
