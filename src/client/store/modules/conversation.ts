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
import { Role } from '@/shared/types/entities';
import { makeAutoObservable, reaction } from 'mobx';

const isActiveAssistMessage = (message?: Message) =>
  message &&
  message.role === Role.ASSIST &&
  (message.meta?.streaming || message.meta?.loading);

interface StreamingState {
  buffer: string;
  timer: ReturnType<typeof setInterval> | null;
}

@store()
export class ConversationStore {
  @hydrate()
  conversations: Conversation[] = [];

  @hydrate()
  currentConversationId?: string;

  @hydrate()
  messages: Record<string, Message[]> = {};

  private streamingStates: Map<string, StreamingState> = new Map();

  constructor() {
    makeAutoObservable<ConversationStore, 'streamingStates'>(this, {
      streamingStates: false,
    });
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

  get currentConversation(): Conversation | undefined {
    return this.conversations.find(
      each => each.id === this.currentConversationId,
    );
  }

  @api('/api/conversation', { method: 'post' })
  async createConversation(
    _params: CreateConversationRequest,
    req?: ApiRequest<CreateConversationRequest>,
  ) {
    const result = await req!.send();

    if (result) {
      this.setCurrentConversationId((result as Conversation).id);

      await this.getAllConversations();
    }
  }

  @api('/api/conversation')
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

  @api((req: UpdateConversationRequest) => `/api/conversation/${req.id}`, {
    method: 'put',
  })
  async updateConversation(
    _params: UpdateConversationRequest,
    req?: ApiRequest<UpdateConversationRequest>,
  ) {
    const result = (await req!.send()) as Conversation;

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
    (req: AddMessageToConversationRequest) =>
      `/api/conversation/${req.id}/messages`,
    {
      method: 'post',
    },
  )
  async addMessageToConversation(
    params: AddMessageToConversationRequest,
    req?: ApiRequest<AddMessageToConversationRequest>,
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
    (req: BatchDeleteMessagesInConversationRequest) =>
      `/api/conversation/${req.id}/messages`,
    {
      method: 'delete',
    },
  )
  async batchDeleteMessagesInConversation(
    params: BatchDeleteMessagesInConversationRequest,
    req?: ApiRequest<BatchDeleteMessagesInConversationRequest>,
  ) {
    await req!.send();
    await this.getMessagesByConversationId({ id: params.id });
  }

  get currentMessages(): Message[] {
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

    if (meta) {
      lastMessage.meta = meta;
    }

    if (deltaContent) {
      const state = this.streamingStates.get(conversationId) ?? {
        buffer: '',
        timer: null,
      };
      state.buffer += deltaContent;
      this.streamingStates.set(conversationId, state);
      this.startTypewriter(conversationId);
    }
  }

  private startTypewriter(conversationId: string) {
    const state = this.streamingStates.get(conversationId);
    if (!state || state.timer) return;

    state.timer = setInterval(() => {
      this.flushTypewriterChunk(conversationId);
    }, 15);
  }

  private flushTypewriterChunk(conversationId: string) {
    const state = this.streamingStates.get(conversationId);

    if (!state || state.buffer.length === 0) {
      this.clearStreaming(conversationId);
      return;
    }

    const messages = this.messages[conversationId];
    if (!messages) {
      this.clearStreaming(conversationId);
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!isActiveAssistMessage(lastMessage)) {
      this.clearStreaming(conversationId);
      return;
    }

    const chunk = state.buffer.slice(0, 3);
    state.buffer = state.buffer.slice(3);
    lastMessage.content += chunk;
  }

  clearStreaming(conversationId: string) {
    const state = this.streamingStates.get(conversationId);
    if (state?.timer) {
      clearInterval(state.timer);
    }
    this.streamingStates.delete(conversationId);
  }
}
