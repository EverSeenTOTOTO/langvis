import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  CancelChatRequest,
  StartChatRequest,
} from '@/shared/dto/controller';
import { SSEMessage } from '@/shared/types';
import { isClient } from '@/shared/utils';
import { message } from 'antd';
import { makeAutoObservable, reaction } from 'mobx';
import { inject } from 'tsyringe';
import { ConversationStore } from './conversation';
import { SettingStore } from './setting';

@store()
export class ChatStore {
  private eventSources: Map<string, EventSource> = new Map();

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
            conversationId: prevId,
            messageId: conversationStore.activeAssistMessage.id,
            reason: 'Cancelled due to conversation switch',
          });
        }
      },
    );
  }

  isConnected(conversationId: string): boolean {
    return (
      this.eventSources.get(conversationId)?.readyState === EventSource.OPEN
    );
  }

  connectToSSE(
    conversationId: string,
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

  disconnectFromSSE(conversationId: string) {
    this.eventSources.get(conversationId)?.close();
    this.eventSources.delete(conversationId);
  }

  @api((req: CancelChatRequest) => `/api/chat/cancel/${req.conversationId}`, {
    method: 'post',
  })
  async cancelChat(
    _params: CancelChatRequest,
    req?: ApiRequest<CancelChatRequest>,
  ) {
    await req!.send();
  }

  @api((req: StartChatRequest) => `/api/chat/start/${req.conversationId}`, {
    method: 'post',
  })
  async startChat(
    _params: StartChatRequest,
    req?: ApiRequest<StartChatRequest>,
  ) {
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
          msg.content,
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
