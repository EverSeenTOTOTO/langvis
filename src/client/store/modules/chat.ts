import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  CancelChatRequest,
  StartChatRequest,
} from '@/shared/dto/controller';
import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { isClient } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { v4 as uuid } from 'uuid';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

interface StreamingState {
  eventSource: EventSource | null;
  message: Message;
  buffer: string;
  timer: ReturnType<typeof setInterval> | null;
}

@store()
export class ChatStore {
  private streamingStates = new Map<string, StreamingState>();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable<ChatStore, 'streamingStates'>(this, {
      streamingStates: false,
    });

    reaction(
      () => conversationStore.currentConversationId,
      (_, prevId) => {
        if (prevId && this.currentStreamingMessage) {
          this.cancelChat({
            conversationId: prevId,
            messageId: this.currentStreamingMessage.id,
            reason: 'Cancelled due to conversation switch',
          });
        }
      },
    );
  }

  get currentStreamingMessage(): Message | undefined {
    const lastMessage =
      this.conversationStore.currentMessages[
        this.conversationStore.currentMessages.length - 1
      ];

    // not be tracked by mobx
    const streamingMessage = this.streamingStates.get(
      this.conversationStore.currentConversationId!,
    )?.message;

    return lastMessage?.id === streamingMessage?.id ? lastMessage : undefined;
  }

  isConnected(conversationId: string): boolean {
    return (
      this.streamingStates.get(conversationId)?.eventSource?.readyState ===
      EventSource.OPEN
    );
  }

  connectToSSE(
    conversationId: string,
    onMessage?: (msg: AgentEvent) => void,
  ): Promise<void> {
    this.disconnectFromSSE(conversationId);

    return new Promise((resolve, reject) => {
      const path = `/api/chat/sse/${conversationId}`;
      const url =
        path.startsWith('/') && !isClient() ? getPrefetchPath(path) : path;

      const eventSource = new EventSource(url, {
        withCredentials: true,
      });

      const existingState = this.streamingStates.get(conversationId);
      if (existingState) {
        existingState.eventSource = eventSource;
      } else {
        this.streamingStates.set(conversationId, {
          eventSource,
          message: null as unknown as Message,
          buffer: '',
          timer: null,
        });
      }

      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('SSE connection timeout'));
      }, 30000);

      eventSource.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      eventSource.addEventListener('error', () => {
        eventSource.close();
        reject();
      });
      eventSource.addEventListener('message', event => {
        clearTimeout(timeout);
        resolve();

        try {
          const parsedData: AgentEvent = JSON.parse(event.data);

          onMessage?.(parsedData);
        } catch (e) {
          message.error(
            `${this.settingStore.tr('Failed parsing  SSE message')}: ${(e as Error).message}`,
          );
        }
      });
    });
  }

  disconnectFromSSE(conversationId: string) {
    const state = this.streamingStates.get(conversationId);
    if (state?.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  }

  @api((req: CancelChatRequest) => `/api/chat/cancel/${req.conversationId}`, {
    method: 'post',
  })
  async cancelChat(
    params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    await req!.send();
    this.clearStreaming(params.conversationId);
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

    this.addPendingMessages(conversationId, params.content!);

    if (!this.isConnected(conversationId)) {
      try {
        await this.connectToSSE(conversationId, msg => {
          this.handleSSEMessage(conversationId, msg);
        });
      } catch (e) {
        console.error(e);
        message.error(
          `${this.settingStore.tr('Failed to connect to SSE')}: ${(e as Error)?.message}`,
        );
        return;
      }
    }

    await req!.send();
  }

  private async handleSSEMessage(conversationId: string, msg: AgentEvent) {
    if (this.conversationStore.currentConversationId !== conversationId) {
      console.warn(
        `Abort SSE message for non-current conversation: ${conversationId}, current: ${this.conversationStore.currentConversationId}`,
      );
      return;
    }

    switch (msg.type) {
      case 'start':
        await this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        this.syncStreamingMessage(conversationId);
        this.appendStreamingEvent(conversationId, msg);
        break;
      case 'thought':
      case 'tool_call':
      case 'tool_progress':
      case 'tool_result':
      case 'tool_error':
        this.appendStreamingEvent(conversationId, msg);
        break;
      case 'stream':
        this.appendStreamingContent(conversationId, msg.content);
        break;
      case 'final':
        this.disconnectFromSSE(conversationId);
        await this.flushTypewriter(conversationId);
        this.clearStreaming(conversationId);
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;
      case 'error':
        this.disconnectFromSSE(conversationId);
        this.clearStreaming(conversationId);
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;
    }
  }

  private addPendingMessages(
    conversationId: string,
    userContent: string,
  ): void {
    const messages = this.conversationStore.messages[conversationId] ?? [];

    const assistMessage: Message = {
      id: uuid(),
      conversationId,
      role: Role.ASSIST,
      content: '',
      meta: { events: [] },
      createdAt: new Date(),
    };

    this.streamingStates.set(conversationId, {
      eventSource: null,
      message: assistMessage,
      buffer: '',
      timer: null,
    });

    messages.push(
      {
        id: uuid(),
        conversationId,
        role: Role.USER,
        content: userContent,
        createdAt: new Date(),
      },
      assistMessage,
    );

    this.conversationStore.messages[conversationId] = messages;
  }

  private syncStreamingMessage(conversationId: string): void {
    const messages = this.conversationStore.messages[conversationId];
    if (!messages) return;

    const lastMessage = messages[messages.length - 1];
    const state = this.streamingStates.get(conversationId);

    // assert lastMessage

    if (state) {
      state.message = lastMessage;
    } else {
      this.streamingStates.set(conversationId, {
        eventSource: null,
        message: lastMessage,
        buffer: '',
        timer: null,
      });
    }
  }

  private appendStreamingContent(
    conversationId: string,
    deltaContent: string,
  ): void {
    const state = this.streamingStates.get(conversationId);
    if (!state) return;

    state.buffer += deltaContent;

    if (!state.timer) {
      state.timer = setInterval(() => {
        this.flushChunk(conversationId);
      }, 15);
    }
  }

  private appendStreamingEvent(
    conversationId: string,
    event: AgentEvent,
  ): void {
    const state = this.streamingStates.get(conversationId);
    if (!state) return;

    const events = [...(state.message.meta?.events ?? []), event];
    state.message = {
      ...state.message,
      meta: {
        ...state.message.meta,
        events,
      },
    };

    // trigger rerender
    const messages = this.conversationStore.messages[conversationId];
    if (messages.length) {
      messages[messages.length - 1] = state.message;
    }
  }

  private clearStreaming(conversationId: string): void {
    const state = this.streamingStates.get(conversationId);
    if (state?.timer) {
      clearInterval(state.timer);
    }
    this.streamingStates.delete(conversationId);
  }

  private flushTypewriter(conversationId: string): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        const state = this.streamingStates.get(conversationId);
        if (!state || state.buffer.length === 0) {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });
  }

  private flushChunk(conversationId: string): void {
    const state = this.streamingStates.get(conversationId);
    if (!state || state.buffer.length === 0) {
      this.clearStreaming(conversationId);
      return;
    }

    const chunkSize = 3;
    const chunk = state.buffer.slice(0, chunkSize);
    state.buffer = state.buffer.slice(chunkSize);

    state.message = {
      ...state.message,
      content: state.message.content + chunk,
    };

    // trigger rerender
    const messages = this.conversationStore.messages[conversationId];
    if (messages.length) {
      messages[messages.length - 1] = state.message;
    }
  }
}
