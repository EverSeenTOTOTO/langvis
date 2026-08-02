import { Transport } from '@/shared/transport';
import type { StreamFrame } from '@/shared/types/events';
import { isClient } from '@/shared/utils';
import { getPrefetchPath, serverFetch } from '../../../decorator/api';
import { makeObservable, observable, computed } from 'mobx';

const CONNECTION_TIMEOUT_MS = 30_000;

type ConnectionState = 'connecting' | 'connected' | 'closed';

export class SSEClientTransport extends Transport<StreamFrame> {
  private eventSource: EventSource | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  connectionState: ConnectionState = 'connecting';

  constructor(
    private url: string,
    private options?: { withCredentials?: boolean },
  ) {
    super();
    makeObservable(this, {
      connectionState: observable,
      isConnecting: computed,
      isConnected: computed,
    });
  }

  connect(): Promise<void> {
    return isClient() ? this.connectEventSource() : this.connectFetch();
  }

  // Resolve on `connected`, emit `disconnect` on `session_replaced`, else emit
  // the business frame. Returns true = caller stops reading.
  private dispatchFrame(frame: StreamFrame, resolve: () => void): boolean {
    if (frame.type === 'connected') {
      this.connectionState = 'connected';
      resolve();
      return false;
    }
    if (frame.type === 'session_replaced') {
      this.connectionState = 'closed';
      this.emit('disconnect');
      return true;
    }
    this.emit('message', frame);
    return false;
  }

  // ── Browser: native EventSource carries cookies via withCredentials ──────

  private connectEventSource(): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullUrl =
        this.url.startsWith('/') && !isClient()
          ? getPrefetchPath(this.url)
          : this.url;

      const eventSource = new EventSource(fullUrl, {
        withCredentials: this.options?.withCredentials ?? true,
      });
      this.eventSource = eventSource;
      this.connectionState = 'connecting';

      const timeout = setTimeout(() => {
        eventSource.close();
        this.eventSource = null;
        this.connectionState = 'closed';
        reject(new Error('SSE connection timeout'));
      }, CONNECTION_TIMEOUT_MS);

      eventSource.addEventListener('error', () => {
        clearTimeout(timeout);
        eventSource.close();
        this.eventSource = null;
        this.connectionState = 'closed';
        this.emit('disconnect');
      });

      eventSource.addEventListener('message', (event: MessageEvent) => {
        clearTimeout(timeout);
        try {
          const frame = JSON.parse(event.data) as StreamFrame;
          if (this.dispatchFrame(frame, resolve)) {
            eventSource.close();
            this.eventSource = null;
          }
        } catch {
          this.emit('error', 'Failed parsing SSE message');
        }
      });
    });
  }

  // ── CLI/bun: no EventSource, so stream over the shared cookie-jar fetch ──

  private connectFetch(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const timeout = setTimeout(
        () =>
          settle(() => {
            this.connectionState = 'closed';
            this.cancelReader();
            reject(new Error('SSE connection timeout'));
          }),
        CONNECTION_TIMEOUT_MS,
      );

      this.readFetchStream(getPrefetchPath(this.url), frame => {
        if (frame.type === 'connected') clearTimeout(timeout);
        return this.dispatchFrame(frame, () => settle(resolve));
      })
        .then(() => {
          clearTimeout(timeout);
          this.connectionState = 'closed';
          settle(() => reject(new Error('SSE stream closed before connect')));
          this.emit('disconnect');
        })
        .catch((e: unknown) => {
          clearTimeout(timeout);
          this.connectionState = 'closed';
          settle(() => reject(e as Error));
          this.emit('disconnect');
        });
    });
  }

  // Open the SSE URL over the cookie-jar fetch, calling `onFrame` until it returns true.
  private async readFetchStream(
    url: string,
    onFrame: (frame: StreamFrame) => boolean,
  ): Promise<void> {
    const fetchFn = await serverFetch.init();
    const resp = await fetchFn(url, {
      headers: { accept: 'text/event-stream' },
    });
    if (!resp.ok || !resp.body) throw new Error(`SSE HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const dataLine = buffer
            .slice(0, idx)
            .split('\n')
            .find(l => l.startsWith('data:'));
          buffer = buffer.slice(idx + 2);
          if (!dataLine) continue; // heartbeat (':') or non-data event
          const frame = this.parseFrame(dataLine.slice(5).trim());
          if (frame && onFrame(frame)) {
            reader.cancel().catch(() => {});
            return;
          }
        }
      }
    } finally {
      this.reader = null;
    }
  }

  private parseFrame(json: string): StreamFrame | null {
    if (!json) return null;
    try {
      return JSON.parse(json) as StreamFrame;
    } catch {
      this.emit('error', 'Failed parsing SSE message');
      return null;
    }
  }

  private cancelReader(): void {
    this.reader?.cancel().catch(() => {});
    this.reader = null;
  }

  send(_message: StreamFrame): boolean {
    return false;
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
    this.cancelReader();
    this.connectionState = 'closed';
  }

  close(): void {
    this.disconnect();
  }

  get isConnecting(): boolean {
    return this.connectionState === 'connecting';
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected';
  }
}
