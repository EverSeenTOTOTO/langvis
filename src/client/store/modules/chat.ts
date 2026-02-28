import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
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
import { isClient } from '@/shared/utils';
import { message } from 'antd';
import { reaction } from 'mobx';
import { inject } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { ConversationStore } from './conversation';
import { ConversationState } from './ConversationState';
import { SettingStore } from './setting';

@store()
export class ChatStore {
  private states = new Map<string, ConversationState>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    reaction(
      () => conversationStore.currentConversationId,
      (_newId, prevId) => {
        if (prevId) {
          const prevState = this.getState(prevId);
          if (prevState?.isLoading) {
            this.cancelChat({
              conversationId: prevId,
              messageId: '',
              reason: 'Cancelled due to conversation switch',
            });
          }
        }
      },
    );
  }

  getState(conversationId: string): ConversationState | undefined {
    return this.states.get(conversationId);
  }

  getOrCreateState(conversationId: string): ConversationState {
    let state = this.states.get(conversationId);
    if (!state) {
      state = new ConversationState();
      this.states.set(conversationId, state);
    }
    return state;
  }

  get isCurrentLoading(): boolean {
    const conversationId = this.conversationStore.currentConversationId;
    if (!conversationId) return false;

    const state = this.states.get(conversationId);
    return state?.isLoading ?? false;
  }

  get currentPhaseError(): string | null {
    const conversationId = this.conversationStore.currentConversationId;
    if (!conversationId) return null;

    const state = this.states.get(conversationId);
    return state?.phaseError ?? null;
  }

  isConnected(conversationId: string): boolean {
    return (
      this.states.get(conversationId)?.eventSource?.readyState ===
      EventSource.OPEN
    );
  }

  connectToSSE(conversationId: string): Promise<void> {
    const state = this.getOrCreateState(conversationId);
    state.closeEventSource();

    return new Promise((resolve, reject) => {
      const path = `/api/chat/sse/${conversationId}`;
      const url =
        path.startsWith('/') && !isClient() ? getPrefetchPath(path) : path;

      const eventSource = new EventSource(url, {
        withCredentials: true,
      });

      state.setEventSource(eventSource);

      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('SSE connection timeout'));
      }, 30_000);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        reject(new Error('SSE connection failed'));
      });

      eventSource.addEventListener('message', event => {
        clearTimeout(timeout);

        try {
          const msg: SSEMessage = JSON.parse(event.data);

          // Wait for 'connected' handshake
          if (msg.type === 'connected') {
            resolve();
            return;
          }

          if (msg.type === 'heartbeat') {
            return;
          }

          if (msg.type === 'session_error') {
            this.handleError(conversationId, msg.error);
            eventSource.close();
            reject(new Error(msg.error));
            return;
          }

          // Business event
          this.handleAgentEvent(conversationId, msg);
        } catch (e) {
          message.error(
            `${this.settingStore.tr('Failed parsing SSE message')}: ${(e as Error).message}`,
          );
        }
      });
    });
  }

  disconnectFromSSE(conversationId: string): void {
    this.states.get(conversationId)?.closeEventSource();
  }

  @api((req: CancelChatRequest) => `/api/chat/cancel/${req.conversationId}`, {
    method: 'post',
  })
  async cancelChat(
    params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    const state = this.getState(params.conversationId);

    // Immediately update UI
    state?.setPhase('cancelled');
    state?.closeEventSource();

    // Rollback pending messages
    this.rollbackPendingMessages(params.conversationId);

    // Only notify backend when phase is streaming (Agent is running)
    // connecting: no Agent running, finishing: Agent already ended
    if (state?.phase === 'streaming') {
      try {
        await req!.send();
      } catch (e) {
        // 404 means session already gone, ignore
        if (!(e instanceof Error && e.message.includes('404'))) {
          throw e;
        }
      }
    }
  }

  @api(
    (req: SubmitHumanInputRequest) => `/api/human-input/${req.conversationId}`,
    { method: 'post' },
  )
  async submitHumanInput(
    _params: SubmitHumanInputRequest,
    req?: ApiRequest<SubmitHumanInputRequest>,
  ) {
    return req!.send();
  }

  @api(
    (req: GetHumanInputStatusRequest) =>
      `/api/human-input/${req.conversationId}`,
  )
  async getHumanInputStatus(
    _params: GetHumanInputStatusRequest,
    req?: ApiRequest<GetHumanInputStatusRequest>,
  ): Promise<GetHumanInputStatusResponse> {
    return req!.send() as Promise<GetHumanInputStatusResponse>;
  }

  @api((req: StartChatRequest) => `/api/chat/start/${req.conversationId}`, {
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

    const state = this.getOrCreateState(conversationId);
    state.setPhase('connecting');

    // Add temporary optimistic messages for immediate UI feedback
    const tempUserId = uuid();
    const tempAssistantId = uuid();
    this.addPendingMessages(
      conversationId,
      params.content!,
      tempUserId,
      tempAssistantId,
    );

    try {
      await this.connectToSSE(conversationId);
    } catch (e) {
      // Check if cancelled during connecting
      if (state.phase === 'cancelled') {
        return;
      }

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
      // Check if cancelled during connecting
      if (state.phase === 'cancelled') {
        return;
      }

      this.handleError(
        conversationId,
        (e as Error)?.message ?? 'Failed to start chat',
      );
    }
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

  private handleAgentEvent(conversationId: string, msg: AgentEvent): void {
    const state = this.getState(conversationId);
    if (!state) return;

    if (this.conversationStore.currentConversationId !== conversationId) {
      console.warn(
        `Ignoring SSE message for non-current conversation: ${conversationId}`,
      );
      return;
    }

    switch (msg.type) {
      case 'start':
        state.transition('streaming');
        this.appendMessageEvent(conversationId, msg);
        break;

      case 'thought':
      case 'tool_call':
      case 'tool_progress':
      case 'tool_result':
      case 'tool_error':
        this.appendMessageEvent(conversationId, msg);
        break;

      case 'stream':
        this.appendMessageContent(conversationId, msg.content);
        break;

      case 'final':
        state.transition('idle');
        state.closeEventSource();
        // Refresh messages to get final state from backend
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;

      case 'cancelled':
        state.transition('cancelled');
        state.closeEventSource();
        break;

      case 'error':
        this.handleError(conversationId, msg.error);
        state.closeEventSource();
        break;
    }
  }

  private handleError(conversationId: string, errorMessage: string): void {
    const state = this.getState(conversationId);
    if (!state) return;

    state.setPhase('error', errorMessage);
    this.rollbackPendingMessages(conversationId);
  }

  private rollbackPendingMessages(conversationId: string): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages) return;

    // Remove the pending user and assistant messages (last 2 messages)
    const lastTwo = messages.slice(-2);
    if (lastTwo.length === 2 && lastTwo[0].role === Role.USER) {
      messages.splice(-2);
      this.conversationStore.messages[conversationId] = [...messages];
    }
  }

  private addPendingMessages(
    conversationId: string,
    userContent: string,
    userId?: string,
    assistantId?: string,
  ): void {
    const messages = this.conversationStore.messages[conversationId] ?? [];

    messages.push(
      {
        id: userId ?? uuid(),
        conversationId,
        role: Role.USER,
        content: userContent,
        createdAt: new Date(),
      },
      {
        id: assistantId ?? uuid(),
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      },
    );

    this.conversationStore.messages[conversationId] = messages;
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
