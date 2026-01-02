import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import { Conversation } from '@/shared/entities/Conversation';
import type { Message } from '@/shared/entities/Message';
import { SSEMessage } from '@/shared/types';
import { isClient } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

type ConversationId = Conversation['id'];
type UserMessage = {
  role: Message['role'];
  content: Message['content'];
  id: ConversationId;
};

@store()
export class ChatStore {
  private eventSources: Map<ConversationId, EventSource> = new Map();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);
    reaction(
      () => conversationStore.currentConversationId,
      (_, prevId) => {
        if (prevId && conversationStore.activeAssistMessage) {
          this.cancelChat({
            id: prevId,
            messageId: conversationStore.activeAssistMessage.id,
            reason: 'Cancelled due to conversation switch',
          });
        }
      },
    );
  }

  isConnected(conversationId: ConversationId): boolean {
    return (
      this.eventSources.get(conversationId)?.readyState === EventSource.OPEN
    );
  }

  connectToSSE(
    conversationId: ConversationId,
    onMessage?: (msg: SSEMessage) => void,
  ): Promise<void> {
    this.disconnectFromSSE(conversationId);

    return new Promise((resolve, reject) => {
      const path = `/api/chat/sse/${conversationId}`;
      const url =
        path.startsWith('/') && !isClient() ? getPrefetchPath(path) : path;

      const eventSource = new EventSource(url, {
        withCredentials: true,
      });
      this.eventSources.set(conversationId, eventSource);

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
          const parsedData: SSEMessage = JSON.parse(event.data);

          onMessage?.(parsedData);
        } catch (e) {
          message.error(
            `${this.settingStore.tr('Failed parsing  SSE message')}: ${(e as Error).message}`,
          );
        }
      });
    });
  }

  disconnectFromSSE(conversationId: ConversationId) {
    this.eventSources.get(conversationId)?.close();
    this.eventSources.delete(conversationId);
  }

  @api((req: { id: string }) => `/api/chat/cancel/${req.id}`, {
    method: 'post',
  })
  async cancelChat(
    _params: { id: string; messageId: string; reason?: string },
    req?: ApiRequest<{ success: boolean }>,
  ) {
    await req!.send();
  }

  @api((req: UserMessage) => `/api/chat/start/${req.id}`, {
    method: 'post',
  })
  async startChat(_params: UserMessage, req?: ApiRequest<Message>) {
    const conversationId = this.conversationStore.currentConversationId;

    if (!conversationId) {
      message.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

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

    if (this.conversationStore.currentConversationId !== conversationId) return;

    // 刷新消息列表，获取用户消息和服务端创建的空 assistant 消息
    await this.conversationStore.getMessagesByConversationId({
      id: conversationId,
    });
  }

  private handleSSEMessage(conversationId: string, msg: SSEMessage) {
    if (this.conversationStore.currentConversationId !== conversationId) {
      console.warn(
        `Abort SSE message for non-current conversation: ${conversationId}, current: ${this.conversationStore.currentConversationId}`,
      );
      return;
    }

    switch (msg.type) {
      case 'completion_delta':
        this.conversationStore.updateStreamingMessage(
          conversationId,
          msg.content ?? '',
          msg.meta,
        );
        break;
      case 'completion_done':
        this.disconnectFromSSE(conversationId);
        // 刷新消息列表以获取最终的完整消息
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;
      case 'completion_error': {
        this.disconnectFromSSE(conversationId);
        this.conversationStore.getMessagesByConversationId({
          id: conversationId,
        });
        break;
      }
      default:
        break;
    }
  }
}

