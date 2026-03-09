// Mock EventSource for Node test environment
class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = MockEventSource.OPEN;
  onopen: ((this: MockEventSource) => void) | null = null;
  onmessage: ((this: MockEventSource, event: MessageEvent) => void) | null =
    null;
  onerror: ((this: MockEventSource, event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Immediately resolve connection for tests
    setTimeout(() => {
      this.onopen?.call(this);
    }, 0);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

// @ts-expect-error - EventSource doesn't exist in Node
globalThis.EventSource = MockEventSource;
