import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore } from '@/client/store/modules/chat';
import { SettingStore } from '@/client/store/modules/setting';
import { ConversationStore } from '@/client/store/modules/conversation';
import { AgentEvent } from '@/shared/types';

class MockEventSource {
  url: string;
  readyState: number;
  onopen: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  private eventListeners: Map<string, any[]> = new Map();

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
  }

  addEventListener(type: string, listener: any) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);

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
    const listeners = this.eventListeners.get('open') || [];
    listeners.forEach(listener => listener());
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateError(error: any) {
    const listeners = this.eventListeners.get('error') || [];
    listeners.forEach(listener => listener(error));
    if (this.onerror) {
      this.onerror(error);
    }
  }

  simulateMessage(data: string) {
    const listeners = this.eventListeners.get('message') || [];
    listeners.forEach(listener => listener({ data }));
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

vi.mock('@/client/decorator/api', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/client/decorator/api')>();
  return {
    ...actual,
    getPrefetchPath: vi.fn((path: string) => `http://localhost:3000${path}`),
    api: vi.fn(() => () => {}),
  };
});

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
    (global as any).EventSource.CONNECTING = MockEventSource.CONNECTING;
    (global as any).EventSource.OPEN = MockEventSource.OPEN;
    (global as any).EventSource.CLOSED = MockEventSource.CLOSED;

    const mockSettingStore = {
      tr: vi.fn((key: string, params?: Record<string, any>) => {
        if (params && params.error) {
          return `Error parsing SSE message: ${params.error}`;
        }
        return key;
      }),
    } as unknown as SettingStore;

    const mockConversationStore = {
      clearStreaming: vi.fn(),
      getMessagesByConversationId: vi.fn(),
      updateStreamingMessage: vi.fn(),
      currentConversationId: 'test-conversation-id',
    } as unknown as ConversationStore;

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

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );

    const MockEventSourceConstructor = vi.fn(() => mockEventSource) as any;
    MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING;
    MockEventSourceConstructor.OPEN = MockEventSource.OPEN;
    MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED;

    (global as any).EventSource = MockEventSourceConstructor;

    const connectPromise = chatStore.connectToSSE(conversationId);

    mockEventSource.simulateOpen();

    await expect(connectPromise).resolves.toBeUndefined();
    expect(chatStore.isConnected(conversationId)).toBe(true);
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

    const MockEventSourceConstructor = vi.fn(() => mockEventSource) as any;
    MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING;
    MockEventSourceConstructor.OPEN = MockEventSource.OPEN;
    MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED;

    (global as any).EventSource = MockEventSourceConstructor;

    const connectPromise = chatStore.connectToSSE(conversationId);

    mockEventSource.simulateError(new Error('Connection failed'));

    await expect(connectPromise).rejects.toThrow('Connection failed');
  });

  it('should handle valid SSE messages with new format', async () => {
    const conversationId = 'test-conversation-id';
    const mockMessageData: AgentEvent = {
      type: 'stream',
      content: 'Hello',
    };

    const onMessageMock = vi.fn();

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );

    const MockEventSourceConstructor = vi.fn(() => mockEventSource) as any;
    MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING;
    MockEventSourceConstructor.OPEN = MockEventSource.OPEN;
    MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED;

    (global as any).EventSource = MockEventSourceConstructor;

    chatStore.connectToSSE(conversationId, onMessageMock);

    mockEventSource.simulateOpen();

    mockEventSource.simulateMessage(JSON.stringify(mockMessageData));

    expect(onMessageMock).toHaveBeenCalledWith(mockMessageData);
  });

  it('should show error message when SSE message parsing fails', async () => {
    const conversationId = 'test-conversation-id';
    const invalidMessageData = '{ invalid json }';

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );

    const MockEventSourceConstructor = vi.fn(() => mockEventSource) as any;
    MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING;
    MockEventSourceConstructor.OPEN = MockEventSource.OPEN;
    MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED;

    (global as any).EventSource = MockEventSourceConstructor;

    chatStore.connectToSSE(conversationId, () => {});

    mockEventSource.simulateOpen();

    mockEventSource.simulateMessage(invalidMessageData);

    expect(
      vi.mocked((await import('antd')).message.error),
    ).toHaveBeenCalledWith(
      "Failed parsing  SSE message: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    );
  });

  it('should disconnect from SSE', async () => {
    const conversationId = 'test-conversation-id';

    mockEventSource = new MockEventSource(
      `http://localhost:3000/api/chat/sse/${conversationId}`,
    );

    const MockEventSourceConstructor = vi.fn(() => mockEventSource) as any;
    MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING;
    MockEventSourceConstructor.OPEN = MockEventSource.OPEN;
    MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED;

    (global as any).EventSource = MockEventSourceConstructor;

    const connectPromise = chatStore.connectToSSE(conversationId);

    mockEventSource.simulateOpen();

    await connectPromise;

    expect(chatStore.isConnected(conversationId)).toBe(true);

    chatStore.disconnectFromSSE(conversationId);

    expect((chatStore as any).eventSources.has(conversationId)).toBe(false);
  });
});
