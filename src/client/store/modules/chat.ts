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
import { AgentEvent, SSEMessage } from '@/shared/types';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { ChatSession } from './ChatSession';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

@store()
export class ChatStore {
  private sessions = new Map<string, ChatSession>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);

    reaction(
      () => this.conversationStore.currentConversationId,
      async (newId, oldId) => {
        if (oldId) {
          this.getSession(oldId)?.disconnect();
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

    if (!state || state.phase === 'done') {
      return;
    }

    const session = this.acquireSession(conversationId);
    await session.connect();
  }

  getSession(conversationId: string): ChatSession | undefined {
    return this.sessions.get(conversationId);
  }

  acquireSession(conversationId: string): ChatSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = new ChatSession(conversationId, {
        onEvent: msg => this.handleEvent(conversationId, msg),
        onError: error => this.handleError(conversationId, error),
      });
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  get currentSession(): ChatSession | undefined {
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

    // Idempotency: only cancel if in loading state
    if (!session?.isLoading) {
      return;
    }

    const wasStreaming = session.phase === 'streaming';

    // Immediately update UI
    session.cancel();

    // Add cancelled event to message for immediate UI update
    this.appendMessageEvent(params.conversationId, {
      type: 'cancelled',
      reason: params.reason ?? 'Cancelled by user',
      seq: Date.now(),
      at: Date.now(),
    });

    // Only notify backend when phase was streaming (Agent is running)
    if (wasStreaming) {
      try {
        await req!.send();
      } catch (e) {
        // 404 means session already gone, ignore for idempotency
        if (!(e instanceof Error && e.message.includes('404'))) {
          throw e;
        }
      }
    }

    // Refresh messages to get final state from backend
    this.conversationStore.getMessagesByConversationId({
      id: params.conversationId,
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
      }
    } catch (e) {
      this.handleError(
        conversationId,
        (e as Error)?.message ?? 'Failed to start chat',
      );
    }
  }

  private handleEvent(conversationId: string, msg: SSEMessage): void {
    if (this.conversationStore.currentConversationId !== conversationId) {
      console.warn(
        `Ignoring SSE message for non-current conversation: ${conversationId}`,
      );
      return;
    }

    // Only handle business events (AgentEvent)
    const agentEvent = msg as AgentEvent;
    if (!agentEvent.type) return;

    switch (agentEvent.type) {
      case 'start':
      case 'thought':
      case 'tool_call':
      case 'tool_progress':
      case 'tool_result':
      case 'tool_error':
        this.appendMessageEvent(conversationId, agentEvent);
        break;

      case 'stream':
        this.appendMessageContent(conversationId, agentEvent.content);
        break;

      case 'final':
      case 'cancelled':
        // Refresh messages to get final state from backend
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;

      case 'error':
        this.handleError(conversationId, agentEvent.error);
        break;
    }
  }

  private handleError(conversationId: string, errorMessage: string): void {
    const session = this.getSession(conversationId);
    session?.fail(errorMessage);

    // Backend has already persisted messages, refresh to get the final state
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
