import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore } from '@/client/store/modules/chat';
import { SettingStore } from '@/client/store/modules/setting';
import { ConversationStore } from '@/client/store/modules/conversation';
import { SSEMessage } from '@/shared/types';

class MockEventSource {
  url: string;
  readyState: number;
  onopen: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
  }

  addEventListener(type: string, listener: any) {
    if (type === 'open') {
      this.onopen = listener;
    } else if (type === 'error') {
      this.onerror = listener;
    } else if (type === 'message') {
      this.onmessage = listener;
    }
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateError(error: any) {
    if (this.onerror) {
      this.onerror(error);
    }
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

vi.mock('@/client/decorator/api', () => ({
  getPrefetchPath: vi.fn((path: string) => `http://localhost:3000${path}`),
  api: vi.fn(() => () => {}),
}));

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
  },
}));

describe('ChatStore', () => {
  let chatStore: ChatStore;
  let mockEventSource: MockEventSource;

  beforeEach(() => {
    vi.clearAllMocks();

    (global as any).EventSource = MockEventSource;

    const mockSettingStore = {
      tr: vi.fn((key: string, params?: Record<string, any>) => {
        if (params && params.error) {
          return `Error parsing SSE message: ${params.error}`;
        }
        return key;
      }),
    } as unknown as SettingStore;

    const mockConversationStore = {} as unknown as ConversationStore;

    chatStore = new ChatStore(mockConversationStore, mockSettingStore);
  });

  it('should create ChatStore instance', () => {
    expect(chatStore).toBeInstanceOf(ChatStore);
  });

  it('should check if SSE connection is open', () => {
    const conversationId = 'test-conversation-id';
    expect(chatStore.isConnected(conversationId)).toBe(false);
  });

  it('should connect to SSE and resolve when open event is fired', async () => {
    const conversationId = 'test-conversation-id';

    vi.useFakeTimers();

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );
    (global as any).EventSource = vi.fn(() => mockEventSource);

    const connectPromise = chatStore.connectToSSE(conversationId);

    // Immediately simulate the open event
    mockEventSource.simulateOpen();

    await expect(connectPromise).resolves.toBeUndefined();
    expect(chatStore.isConnected(conversationId)).toBe(true);

    vi.useRealTimers();
  }, 10000);

  it('should reject connection when timeout occurs', async () => {
    const conversationId = 'test-conversation-id';

    vi.useFakeTimers();

    const connectPromise = chatStore.connectToSSE(conversationId);

    vi.advanceTimersByTime(30000);

    await expect(connectPromise).rejects.toThrow('SSE connection timeout');

    vi.useRealTimers();
  });

  it('should reject connection when error event is fired', async () => {
    const conversationId = 'test-conversation-id';

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );
    (global as any).EventSource = vi.fn(() => mockEventSource);

    const connectPromise = chatStore.connectToSSE(conversationId);

    setTimeout(() => {
      mockEventSource.simulateError(new Error('Connection failed'));
    }, 10);

    await expect(connectPromise).rejects.toThrow('Connection failed');
  });

  it('should handle valid SSE messages', async () => {
    const conversationId = 'test-conversation-id';
    const mockMessageData: SSEMessage = {
      type: 'completion_delta',
      content: 'Hello',
    };

    const onMessageMock = vi.fn();

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );
    (global as any).EventSource = vi.fn(() => mockEventSource);

    chatStore.connectToSSE(conversationId, onMessageMock);

    setTimeout(() => {
      mockEventSource.simulateOpen();
    }, 10);

    await new Promise(resolve => setTimeout(resolve, 50));

    mockEventSource.simulateMessage(JSON.stringify(mockMessageData));

    expect(onMessageMock).toHaveBeenCalledWith(mockMessageData);
  });

  it('should show error message when SSE message parsing fails', async () => {
    const conversationId = 'test-conversation-id';
    const invalidMessageData = '{ invalid json }';

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );
    (global as any).EventSource = vi.fn(() => mockEventSource);

    chatStore.connectToSSE(conversationId, () => {});

    setTimeout(() => {
      mockEventSource.simulateOpen();
    }, 10);

    await new Promise(resolve => setTimeout(resolve, 50));

    mockEventSource.simulateMessage(invalidMessageData);

    expect(
      vi.mocked((await import('antd')).message.error),
    ).toHaveBeenCalledWith(
      "Failed parsing  SSE message: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    );
  });

  it('should disconnect from SSE', () => {
    const conversationId = 'test-conversation-id';

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );
    (global as any).EventSource = vi.fn(() => mockEventSource);

    // Connect to SSE first to properly register it
    chatStore.connectToSSE(conversationId);
    mockEventSource.simulateOpen();

    expect(chatStore.isConnected(conversationId)).toBe(true);

    chatStore.disconnectFromSSE(conversationId);

    // After disconnecting, the event source should be removed from the map
    expect((chatStore as any).eventSources.has(conversationId)).toBe(false);
  });
});
