import { message } from 'antd';
import { singleton } from 'tsyringe';

@singleton()
export class SSEStore {
  eventSource?: EventSource;

  timeout?: NodeJS.Timeout;

  handles: Map<string, (data: any) => void> = new Map();

  async connect() {
    if (this.eventSource?.OPEN) return;
    return new Promise((resolve, reject) => {
      this.checkTimeout().catch(reject);
      this.eventSource = new EventSource('/api/sse', {
        withCredentials: true,
      });
      this.eventSource.addEventListener('error', e => {
        clearTimeout(this.timeout!);
        console.error(e);
        reject(e);
        this.close();
      });
      this.eventSource.addEventListener('open', resolve);
      this.eventSource.addEventListener('message', e => {
        clearTimeout(this.timeout!);
        this.handleSSE(e);
      });
    });
  }

  async checkTimeout(timeout = 5000) {
    clearTimeout(this.timeout!);
    return new Promise((_, reject) => {
      this.timeout = setTimeout(() => {
        this.close();
        reject(new Error(`SSE connect timeout`));
      }, timeout);
    });
  }

  protected handleSSE(e: MessageEvent<any>) {
    try {
      const { event, data } = JSON.parse(e.data) as {
        event: string;
        data: any;
      };

      return this.handles.get(event)?.(data);
    } catch (e) {
      message.error('SSE data parse error');
      console.error(e);
    }
  }

  close() {
    this.eventSource?.close();
    this.eventSource = undefined;
  }

  register(event: string, handler: (data: any) => void) {
    if (this.handles.has(event)) {
      throw new Error(`Event ${event} already registered`);
    }

    this.handles.set(event, handler);
  }

  unregister(event: string) {
    this.handles.delete(event);
  }
}
