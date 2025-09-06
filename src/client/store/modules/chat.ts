import { makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';
import { getPrefetchPath } from '@/client/decorator/api';
import { Conversation } from '@/shared/entities/Conversation';
import { message } from 'antd';
import { SSEMessage } from '@/shared/types';

type ConversationId = Conversation['id'];
type Callback = (data: any) => void;

@singleton()
export class ChatStore {
  private eventSource: EventSource | null = null;
  private listeners: Map<ConversationId, Callback> = new Map();

  constructor() {
    makeAutoObservable(this);
  }

  connectToSSE(conversationId: ConversationId): Promise<void> {
    this.disconnectFromSSE();

    return new Promise((resolve, reject) => {
      const path = `/api/chat/sse/${conversationId}`;
      const url = path.startsWith('/') ? getPrefetchPath(path) : path;

      this.eventSource = new EventSource(url);

      if (this.eventSource) {
        this.eventSource.addEventListener('open', () => resolve());
        this.eventSource.addEventListener('error', reject);
        this.eventSource.addEventListener('message', event => {
          try {
            const parsedData: SSEMessage = JSON.parse(event.data);
            this.handleMessage(parsedData);
          } catch (e) {
            console.error('Error parsing SSE message:', e);
          }
        });
      } else {
        reject(new Error('Failed to create EventSource'));
      }
    });
  }

  private handleMessage(sseMessage: SSEMessage) {
    if (!('data' in sseMessage)) {
      message.error('Invalid SSE message format');
      console.error('Invalid SSE message format:', sseMessage);
      return;
    }

    const { conversationId, data } = sseMessage;

    this.listeners.get(conversationId)?.(data);
  }

  register(conversationId: ConversationId, callback: Callback) {
    this.listeners.set(conversationId, callback);
  }

  unregister(conversationId: ConversationId) {
    this.listeners.delete(conversationId);
  }

  disconnectFromSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}
