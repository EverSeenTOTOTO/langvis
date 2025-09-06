import { getPrefetchPath } from '@/client/decorator/api';
import { Conversation } from '@/shared/entities/Conversation';
import { SSEMessage } from '@/shared/types';
import { message } from 'antd';
import { makeAutoObservable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { SettingStore } from './setting';
import { isClient } from '@/shared/constants';

type ConversationId = Conversation['id'];

@singleton()
export class ChatStore {
  private eventSources: Map<ConversationId, EventSource> = new Map();

  constructor(@inject(SettingStore) private settingStore: SettingStore) {
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
      eventSource.addEventListener('message', event => {
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
}
