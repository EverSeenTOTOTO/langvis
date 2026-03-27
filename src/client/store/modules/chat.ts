import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  CancelChatRequest,
  GetHumanInputStatusRequest,
  GetHumanInputStatusResponse,
  StartChatRequest,
  StartChatResponse,
  SubmitHumanInputRequest,
} from '@/shared/dto/controller';
import { AgentEvent } from '@/shared/types';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { ConversationFSM } from './ConversationFSM';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

@store()
export class ChatStore {
  private sessions = new Map<string, ConversationFSM>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);

    reaction(
      () => this.conversationStore.currentConversationId,
      async (newId, oldId) => {
        // Deactivate old session (soft cancel, don't call cancel API)
        if (oldId) {
          this.getSession(oldId)?.deactivate();
        }

        if (!newId) return;

        await this.conversationStore.getMessagesByConversationId({ id: newId });
        await this.activateConversation(newId);
      },
    );
  }

  @api('/api/chat/session/:conversationId')
  async getSessionState(
    _params: { conversationId: string },
    req?: ApiRequest<{ conversationId: string }>,
  ): Promise<{ phase: 'waiting' | 'running' | 'done' } | null> {
    return req!.send() as Promise<{
      phase: 'waiting' | 'running' | 'done';
    } | null>;
  }

  async activateConversation(conversationId: string): Promise<void> {
    const state = await this.getSessionState({ conversationId });

    if (!state || state.phase === 'done') return;

    const session = this.acquireSession(conversationId);
    try {
      await session.connect();
    } catch {
      this.handleError(conversationId, 'SSE connection failed');
      this.conversationStore.getMessagesByConversationId({
        id: conversationId,
      });
    }
  }

  getSession(conversationId: string): ConversationFSM | undefined {
    return this.sessions.get(conversationId);
  }

  acquireSession(conversationId: string): ConversationFSM {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = new ConversationFSM(conversationId, {
        onEvent: (convId, event) => this.handleEvent(convId, event),
        onError: (convId, error) => this.handleError(convId, error),
        onRefreshMessages: convId => this.refreshMessages(convId),
      });
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  get currentSession(): ConversationFSM | undefined {
    const conversationId = this.conversationStore.currentConversationId;
    if (!conversationId) return undefined;
    return this.sessions.get(conversationId);
  }

  @api('/api/chat/cancel/:conversationId', {
    method: 'post',
  })
  async cancelChat(
    params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    const session = this.getSession(params.conversationId);
    if (!session) return;

    await session.cancelConversation(async () => {
      await req!.send();
    });
  }

  @api('/api/human-input/:conversationId', { method: 'post' })
  async submitHumanInput(
    _params: SubmitHumanInputRequest,
    req?: ApiRequest<SubmitHumanInputRequest>,
  ) {
    return req!.send();
  }

  @api('/api/human-input/:conversationId')
  async getHumanInputStatus(
    _params: GetHumanInputStatusRequest,
    req?: ApiRequest<GetHumanInputStatusRequest>,
  ): Promise<GetHumanInputStatusResponse> {
    return req!.send();
  }

  @api('/api/chat/start/:conversationId', {
    method: 'post',
  })
  async startChat(
    params: StartChatRequest,
    req?: ApiRequest<StartChatRequest>,
  ) {
    const conversationId = this.conversationStore.currentConversationId;

    if (!conversationId) {
      message.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

    const session = this.acquireSession(conversationId);

    // Add temporary optimistic messages for immediate UI feedback
    const tempAssistantId = generateId('msg');
    this.addPendingMessages(
      conversationId,
      params.content!,
      generateId('msg'),
      tempAssistantId,
    );

    // Create MessageFSM for the placeholder assistant message
    const messages = this.conversationStore.messages[conversationId];
    const assistantMessage = messages?.[messages.length - 1];
    if (assistantMessage && assistantMessage.id === tempAssistantId) {
      session.addMessageFSM(tempAssistantId, assistantMessage);
    }

    try {
      await session.connect();
    } catch (e) {
      this.handleError(
        conversationId,
        (e as Error)?.message ?? 'SSE connection failed',
      );
      return;
    }

    try {
      const res = (await req!.send()) as StartChatResponse;

      // Replace temporary assistant message ID with the real one from backend
      if (res.messageId) {
        this.replaceAssistantMessageId(
          conversationId,
          tempAssistantId,
          res.messageId,
        );
        // Update MessageFSM with new ID
        session.removeMessageFSM(tempAssistantId);
        const updatedMessages = this.conversationStore.messages[conversationId];
        const updatedAssistant = updatedMessages?.[updatedMessages.length - 1];
        if (updatedAssistant && updatedAssistant.id === res.messageId) {
          session.addMessageFSM(res.messageId, updatedAssistant);
        }
      }
    } catch (e) {
      this.handleError(
        conversationId,
        (e as Error)?.message ?? 'Failed to start chat',
      );
    }
  }

  private handleEvent(conversationId: string, event: AgentEvent): void {
    if (this.conversationStore.currentConversationId !== conversationId) {
      console.warn(
        `Ignoring SSE message for non-current conversation: ${conversationId}`,
      );
      return;
    }

    switch (event.type) {
      case 'start':
      case 'thought':
      case 'tool_call':
      case 'tool_progress':
      case 'tool_result':
      case 'tool_error':
        this.appendMessageEvent(conversationId, event);
        break;

      case 'stream':
        this.appendMessageContent(conversationId, event.content);
        break;

      case 'final':
      case 'cancelled':
      case 'error':
        // Refresh handled by ConversationFSM
        break;
    }
  }

  private handleError(conversationId: string, errorMessage: string): void {
    const session = this.getSession(conversationId);
    if (session?.phase === 'canceled') return;

    // Add error event to message
    this.appendMessageEvent(conversationId, {
      type: 'error',
      error: errorMessage,
      seq: Date.now(),
      at: Date.now(),
    });

    this.refreshMessages(conversationId);
  }

  private refreshMessages(conversationId: string): void {
    this.conversationStore.getMessagesByConversationId({ id: conversationId });
  }

  private appendMessageContent(conversationId: string, content: string): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    lastMessage.content += content;
  }

  private appendMessageEvent(conversationId: string, event: AgentEvent): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage.meta) {
      lastMessage.meta = { events: [] };
    }
    lastMessage.meta.events = lastMessage.meta.events ?? [];
    lastMessage.meta.events.push(event);
  }

  private addPendingMessages(
    conversationId: string,
    userContent: string,
    userId?: string,
    assistantId?: string,
  ): void {
    const existingMessages =
      this.conversationStore.messages[conversationId] ?? [];

    // Create new array to trigger MobX reactivity
    this.conversationStore.messages[conversationId] = [
      ...existingMessages,
      {
        id: userId ?? generateId('msg'),
        conversationId,
        role: Role.USER,
        content: userContent,
        createdAt: new Date(),
      },
      {
        id: assistantId ?? generateId('msg'),
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      },
    ];
  }

  private replaceAssistantMessageId(
    conversationId: string,
    oldId: string,
    newId: string,
  ): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.id === oldId) {
      lastMessage.id = newId;
    }
  }
}
