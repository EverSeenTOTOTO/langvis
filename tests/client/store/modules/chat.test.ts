import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// connect 的实现由每个用例决定，但 vi.mock 工厂在模块加载前求值，
// 故用 vi.hoisted 把句柄提升出去，工厂内引用同一个 mock。
const { connectMock, messageErrorMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  messageErrorMock: vi.fn(),
}));

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

vi.mock('antd', () => ({
  message: {
    error: messageErrorMock,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
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
    // 都进入 ensureConnected 时，应复用同一条 in-flight 连接。
    let resolveConnect: () => void = () => {};
    connectMock.mockImplementation(
      () => new Promise<void>(resolve => (resolveConnect = resolve)),
    );

    const p1 = chatStore.ensureConnected('conv_1');
    const p2 = chatStore.ensureConnected('conv_1');

    expect(MockedTransport).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);

    resolveConnect();
    await Promise.all([p1, p2]);
  });

  it('connects separately for different conversations', async () => {
    await chatStore.ensureConnected('conv_a');
    await chatStore.ensureConnected('conv_b');

    expect(MockedTransport).toHaveBeenCalledTimes(2);
  });

  it('routes run_view → applyView, and refreshes on terminal transition', async () => {
    await chatStore.ensureConnected('conv_1');
    const transport = MockedTransport.mock.results[0].value;
    const messageHandler = (transport.addEventListener as Mock).mock.calls.find(
      ([ev]) => ev === 'message',
    )?.[1] as ((e: { detail: unknown }) => void) | undefined;
    if (!messageHandler) throw new Error('message listener not registered');

    const node = new MessageNode({
      id: 'm1',
      conversationId: 'conv_1',
      role: Role.ASSIST,
      createdAt: new Date(),
    });
    (chatStore as any).messageNodes.set('conv_1', new Map([['m1', node]]));
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

describe('ChatStore startChat', () => {
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

  it('ensures the SSE session is (re)activated before posting (#5: idle-eviction recovery)', async () => {
    // 发送前必须先 ensureConnected：长 idle 后 SSE 静默断开、服务端 session 已被
    // idle 回收，重连 /activate 重新激活 memory，避免 POST /start 撞上 getMemory not activated。
    const order: string[] = [];
    connectMock.mockImplementation(() => {
      order.push('connect');
      return Promise.resolve();
    });
    const req = {
      send: vi.fn().mockImplementation(() => {
        order.push('send');
        return Promise.resolve({ messageId: 'm_asst' });
      }),
    };

    await chatStore.startChat(
      { conversationId: 'conv_1', role: Role.USER, content: 'hi' },
      req as any,
    );

    // connect 先于 send 完成 —— 证明发送路径会先保证会话激活。
    expect(order).toEqual(['connect', 'send']);
    expect(MockedTransport).toHaveBeenCalledWith('/api/chat/activate/conv_1');
    expect(req.send).toHaveBeenCalledTimes(1);
  });

  it('does not post when (re)activation fails — fail-clean (#5)', async () => {
    // ensureConnected 连不上时不应盲发 POST（否则服务端 getMemory 必抛 not activated → 500）：
    // 提示 + 刷新 + 直接返回，send 不被调用。
    connectMock.mockRejectedValue(new Error('SSE timeout'));
    const req = { send: vi.fn().mockResolvedValue({ messageId: 'm_asst' }) };
    const refreshSpy = vi
      .spyOn(chatStore as any, 'refreshMessages')
      .mockImplementation(() => {});

    await chatStore.startChat(
      { conversationId: 'conv_1', role: Role.USER, content: 'hi' },
      req as any,
    );

    expect(req.send).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith('Failed to connect to SSE');
    expect(refreshSpy).toHaveBeenCalledWith('conv_1');
  });
});
