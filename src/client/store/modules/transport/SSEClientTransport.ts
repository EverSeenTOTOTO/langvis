import { Transport } from '@/shared/transport';
import type { SSEFrame } from '@/shared/types/events';
import { isClient } from '@/shared/utils';
import { getPrefetchPath } from '../../../decorator/api';

const CONNECTION_TIMEOUT_MS = 30_000;

export class SSEClientTransport extends Transport<SSEFrame> {
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
          const frame: SSEFrame = JSON.parse(event.data);

          if (frame.type === 'connected') {
            resolve();
            return;
          }

          if (frame.type === 'session_replaced') {
            eventSource.close();
            this.eventSource = null;
            this.emit('disconnect');
            return;
          }

          if (frame.type === 'session_error') {
            eventSource.close();
            this.eventSource = null;
            this.emit('error', frame.error);
            return;
          }

          // Business frame
          this.emit('message', frame);
        } catch {
          this.emit('error', 'Failed parsing SSE message');
        }
      });
    });
  }

  send(_message: SSEFrame): boolean {
    return false;
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  close(): void {
    this.disconnect();
  }

  get isConnecting(): boolean {
    return this.eventSource?.readyState === EventSource.CONNECTING;
  }

  get isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
