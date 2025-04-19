import { singleton } from 'tsyringe';

@singleton()
export class SSEStore {
  eventSource?: EventSource;

  timeout?: NodeJS.Timeout;

  async connect(timeout?: number) {
    if (this.eventSource?.OPEN) return;
    return new Promise<void>((resolve, reject) => {
      this.checkTimeout(timeout).catch(reject);
      this.eventSource = new EventSource('/api/sse');
      this.eventSource.addEventListener('error', e => {
        clearTimeout(this.timeout!);
        console.error(e);
        this.close();
        reject(e);
      });
      this.eventSource.addEventListener('open', () => {
        clearTimeout(this.timeout!);
        resolve();
      });
    });
  }

  async checkTimeout(timeout = 5000) {
    clearTimeout(this.timeout!);
    return new Promise((_, reject) => {
      this.timeout = setTimeout(() => {
        this.close();
        reject(new Error(`SSE connect timeout in ${timeout}ms`));
      }, timeout);
    });
  }

  close() {
    this.eventSource?.close();
    this.eventSource = undefined;
  }

  register(event: string, listener: (e: any) => void) {
    this.eventSource?.addEventListener(event, listener);
  }

  unregister(event: string, listener: (e: any) => void) {
    this.eventSource?.removeEventListener(event, listener);
  }
}
