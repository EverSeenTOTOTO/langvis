import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  CancelChatRequest,
  GetHumanInputStatusRequest,
  GetHumanInputStatusResponse,
  StartChatRequest,
  SubmitHumanInputRequest,
} from '@/shared/dto/controller';
import { AgentEvent, SSEMessage } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
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
              messageId: prevState.streamingMessage?.id ?? '',
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

  get currentStreamingMessage(): Message | undefined {
    const conversationId = this.conversationStore.currentConversationId;
    if (!conversationId) return undefined;

    const state = this.states.get(conversationId);
    return state?.streamingMessage ?? undefined;
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
    state?.flushBufferImmediately();

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
    this.addPendingMessages(conversationId, params.content!);

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
      await req!.send();
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
        this.conversationStore
          .getMessagesByConversationId({ id: conversationId })
          .then(() => {
            this.syncStreamingMessage(conversationId);
            state.appendEvent(msg);
          });
        break;

      case 'thought':
      case 'tool_call':
      case 'tool_progress':
      case 'tool_result':
      case 'tool_error':
        state.appendEvent(msg);
        break;

      case 'stream':
        state.appendBuffer(msg.content);
        break;

      case 'final':
        state.transition('finishing');
        state.closeEventSource();
        state.waitForTypewriter(() => {
          state.setPhase('idle');
          this.conversationStore.getMessagesByConversationId({
            id: conversationId,
          });
        });
        break;

      case 'cancelled':
        state.transition('cancelled');
        state.closeEventSource();
        state.flushBufferImmediately();
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
    state.flushBufferImmediately();
    state.closeEventSource();

    // Rollback pending messages if in connecting phase
    if (state.pendingMessageIds.length > 0) {
      const messages = this.conversationStore.messages[conversationId];
      if (messages) {
        const filtered = messages.filter(
          m => !state.pendingMessageIds.includes(m.id),
        );
        this.conversationStore.messages[conversationId] = filtered;
      }
      state.clearPendingMessageIds();
    }
  }

  private addPendingMessages(
    conversationId: string,
    userContent: string,
  ): void {
    const state = this.getOrCreateState(conversationId);
    const messages = this.conversationStore.messages[conversationId] ?? [];

    const userId = uuid();
    const assistantId = uuid();

    messages.push(
      {
        id: userId,
        conversationId,
        role: Role.USER,
        content: userContent,
        createdAt: new Date(),
      },
      {
        id: assistantId,
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      },
    );

    state.addPendingMessageId(userId);
    state.addPendingMessageId(assistantId);

    this.conversationStore.messages[conversationId] = messages;
  }

  private syncStreamingMessage(conversationId: string): void {
    const state = this.getState(conversationId);
    if (!state) return;

    const messages = this.conversationStore.messages[conversationId];
    if (!messages) return;

    const lastMessage = messages[messages.length - 1];
    state.setStreamingMessage(lastMessage);
  }
}
