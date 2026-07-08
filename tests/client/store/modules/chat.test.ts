import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// connect 的实现由每个用例决定，但 vi.mock 工厂在模块加载前求值，
// 故用 vi.hoisted 把句柄提升出去，工厂内引用同一个 mock。
const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock('@/client/decorator/api', () => ({
  api: () => () => {},
  ApiRequest: class {},
}));

vi.mock('@/client/decorator/hydrate', () => ({
  hydrate: () => () => {},
}));

vi.mock('@/client/decorator/store', () => ({
  store: () => (target: any) => target,
}));

vi.mock('@/client/store/modules/transport/SSEClientTransport', () => ({
  SSEClientTransport: vi.fn().mockImplementation((url: string) => ({
    url,
    isConnected: false,
    isConnecting: false,
    connect: connectMock,
    addEventListener: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

import { ChatStore } from '@/client/store/modules/chat';
import { SSEClientTransport } from '@/client/store/modules/transport/SSEClientTransport';
import { MessageNode } from '@/client/store/modules/message-node';
import { Role } from '@/shared/types/entities';

const MockedTransport = SSEClientTransport as unknown as Mock;

describe('ChatStore transport', () => {
  let chatStore: ChatStore;
  let conversationStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(undefined);

    conversationStore = {
      currentConversationId: undefined,
      messages: {},
      conversationUsage: null,
      loopUsage: new Map(),
      getMessagesByConversationId: vi.fn().mockResolvedValue([]),
    };
    const settingStore = { tr: (s: string) => s } as any;

    chatStore = new ChatStore(conversationStore, settingStore);
  });

  it('dedupes concurrent connects to a single SSE per conversation', async () => {
    // 两个并发调用者（发送前显式激活 + currentConversationId 变化的 reaction）
    // 都进入 connectTransport 时，应复用同一条 in-flight 连接。
    let resolveConnect: () => void = () => {};
    connectMock.mockImplementation(
      () => new Promise<void>(resolve => (resolveConnect = resolve)),
    );

    const p1 = (chatStore as any).connectTransport('conv_1');
    const p2 = (chatStore as any).connectTransport('conv_1');

    expect(MockedTransport).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);

    resolveConnect();
    await Promise.all([p1, p2]);
  });

  it('connects separately for different conversations', async () => {
    await (chatStore as any).connectTransport('conv_a');
    await (chatStore as any).connectTransport('conv_b');

    expect(MockedTransport).toHaveBeenCalledTimes(2);
  });

  it('routes run_view → applyView, and refreshes on terminal transition', async () => {
    await (chatStore as any).connectTransport('conv_1');
    const transport = MockedTransport.mock.results[0].value;
    const messageHandler = (
      transport.addEventListener as Mock
    ).mock.calls.find(([ev]) => ev === 'message')?.[1] as
      | ((e: { detail: unknown }) => void)
      | undefined;
    if (!messageHandler) throw new Error('message listener not registered');

    const node = new MessageNode({
      id: 'm1',
      conversationId: 'conv_1',
      role: Role.ASSIST,
      createdAt: new Date(),
    });
    (chatStore as any).messageNodes.set(
      'conv_1',
      new Map([['m1', node]]),
    );
    // Read loopUsage through the store's own reference — makeAutoObservable
    // deep-wraps conversationStore, so the test's direct reference would diverge.
    const loopUsage = (chatStore as any).conversationStore.loopUsage as Map<
      string,
      unknown
    >;

    const runView = (status: string) => ({
      type: 'run_view',
      messageId: 'm1',
      runId: 'r1',
      content: 'hello',
      steps: [],
      status,
      awaitingInput: null,
      processSummary: null,
      audio: null,
    });

    // Running view → state replaced, no terminal refresh.
    messageHandler({ detail: runView('running') });
    expect(node.content).toBe('hello');
    expect(node.status).toBe('running');

    // Terminal view → refresh + loopUsage cleared, exactly once.
    loopUsage.set('r1', { used: 5, total: 4096 });
    const refreshSpy = vi
      .spyOn(chatStore as any, 'refreshMessages')
      .mockImplementation(() => {});
    messageHandler({ detail: runView('completed') });
    expect(node.status).toBe('completed');
    expect(refreshSpy).toHaveBeenCalledWith('conv_1');
    expect(loopUsage.has('r1')).toBe(false);
  });
});
