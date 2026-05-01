import { Transport } from '@/shared/transport';
import type { SSEMessage } from '@/shared/types';
import { isClient } from '@/shared/utils';
import { getPrefetchPath } from '../../../decorator/api';

const CONNECTION_TIMEOUT_MS = 30_000;

export class SSEClientTransport extends Transport<SSEMessage> {
  private eventSource: EventSource | null = null;

  constructor(
    private url: string,
    private options?: { withCredentials?: boolean },
  ) {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullUrl =
        this.url.startsWith('/') && !isClient()
          ? getPrefetchPath(this.url)
          : this.url;

      const eventSource = new EventSource(fullUrl, {
        withCredentials: this.options?.withCredentials ?? true,
      });

      this.eventSource = eventSource;

      const timeout = setTimeout(() => {
        eventSource.close();
        this.eventSource = null;
        reject(new Error('SSE connection timeout'));
      }, CONNECTION_TIMEOUT_MS);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        this.eventSource = null;
        this.emit('disconnect');
      });

      eventSource.addEventListener('message', (event: MessageEvent) => {
        clearTimeout(timeout);

        try {
          const msg: SSEMessage = JSON.parse(event.data);

          if (msg.type === 'connected') {
            resolve();
            return;
          }

          if (msg.type === 'session_replaced') {
            eventSource.close();
            this.eventSource = null;
            this.emit('disconnect');
            return;
          }

          if (msg.type === 'session_error') {
            eventSource.close();
            this.eventSource = null;
            this.emit('error', msg.error);
            return;
          }

          // Business event
          this.emit('message', msg);
        } catch {
          this.emit('error', 'Failed parsing SSE message');
        }
      });
    });
  }

  send(_message: SSEMessage): boolean {
    return false;
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  close(): void {
    this.disconnect();
  }

  get isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
