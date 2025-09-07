import { api, ApiRequest, getPrefetchPath } from '@/client/decorator/api';
import { isClient } from '@/shared/constants';
import { Conversation } from '@/shared/entities/Conversation';
import type { Message } from '@/shared/entities/Message';
import { Role } from '@/shared/entities/Message';
import { SSEMessage } from '@/shared/types';
import { message } from 'antd';
import { makeAutoObservable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { SettingStore } from './setting';
import { ConversationStore } from './conversation';

type ConversationId = Conversation['id'];
type UserMessage = {
  role: Message['role'];
  content: Message['content'];
  id: ConversationId;
};

@singleton()
export class ChatStore {
  private eventSources: Map<ConversationId, EventSource> = new Map();

  constructor(
    @inject(ConversationStore) private conversationStore: ConversationStore,
    @inject(SettingStore) private settingStore: SettingStore,
  ) {
    makeAutoObservable(this);
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

      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('SSE connection timeout'));
      }, 30000);

      eventSource.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      eventSource.addEventListener('error', reject);
      eventSource.onmessage = event => {
        try {
          const parsedData: SSEMessage = JSON.parse(event.data);

          onMessage?.(parsedData);
        } catch (e) {
          message.error(
            `${this.settingStore.tr('Failed parsing  SSE message')}: ${(e as Error).message}`,
          );
        }
      };
    });
  }

  disconnectFromSSE(conversationId: ConversationId) {
    this.eventSources.get(conversationId)?.close();
    this.eventSources.delete(conversationId);
  }

  @api((req: UserMessage) => `/api/chat/start/${req.id}`, {
    method: 'post',
  })
  async handleUserMessage(_params: UserMessage, req?: ApiRequest<Message>) {
    const id = this.conversationStore.currentConversationId;

    if (!id) {
      message.error(
        this.settingStore.tr('Failed to create or get conversation'),
      );
      return;
    }

    this.conversationStore.addTempMessage(id, Role.USER);

    await req!.send();

    if (this.conversationStore.currentConversationId !== id) return;

    await this.conversationStore.getMessagesByConversationId({ id });

    this.conversationStore.addTempMessage(id, Role.ASSIST);

    if (this.isConnected(id)) return;

    try {
      await this.connectToSSE(id, msg => {
        if (this.conversationStore.currentConversationId !== id) {
          console.warn(
            `Abort SSE message for non-current conversation: ${id}, current: ${this.conversationStore.currentConversationId}`,
          );
          return;
        }
        this.handleSSEMessage(id, msg);
      });
    } catch (e) {
      console.error(e);
      message.error(
        `${this.settingStore.tr('Failed to connect to SSE')}: ${(e as Error)?.message}`,
      );
    }
  }

  private handleSSEMessage(conversationId: string, msg: SSEMessage) {
    const lastMessage =
      this.conversationStore.messages[conversationId].slice(-1)[0];

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

    switch (msg.type) {
      case 'reply': {
        lastMessage.loading = false;
        lastMessage.content += msg.content;
        break;
      }
      case 'error': {
        message.error(`${this.settingStore.tr(msg.error)}`);

        lastMessage.loading = false;
        lastMessage.content = msg.error;
        break;
      }
      default:
        break;
    }
  }
}
