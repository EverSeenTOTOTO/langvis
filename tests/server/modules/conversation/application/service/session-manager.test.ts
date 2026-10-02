import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { EventBus } from '@nestjs/cqrs';
import { StagePlan } from '@/server/shared/context';
import type { ProviderService } from '@/server/infrastructure/provider.service';
import { Transport } from '@/shared/transport';
import type { StreamFrame } from '@/shared/types/events';
import type { CancelRun } from '@/server/modules/agent/contracts';

/** 记录所有 send 帧的最小 Transport 实现。 */
class FakeTransport extends Transport<StreamFrame> {
  sent: StreamFrame[] = [];
  private connected = true;

  async connect(): Promise<void> {}
  disconnect(): void {}
  send(frame: StreamFrame): boolean {
    this.sent.push(frame);
    return true;
  }
  close(): void {
    this.connected = false;
  }
  get isConnected(): boolean {
    return this.connected;
  }
  get isConnecting(): boolean {
    return false;
  }
}

function makeMockChat(activeMessages: unknown[]): ChatService {
  return {
    findActiveAssistantMessages: vi.fn().mockResolvedValue(activeMessages),
    markMessagesTerminated: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatService;
}

function makeManager(activeMessages: unknown[] = []): {
  manager: SessionManager;
  chat: ChatService;
} {
  const chat = makeMockChat(activeMessages);
  const provider = {
    resolveContextSize: vi.fn().mockReturnValue(8000),
  } as unknown as ProviderService;
  const manager = new SessionManager(
    chat,
    {
      publish: vi.fn(),
    } as unknown as EventBus,
    provider,
    new StagePlan([]),
  );
  return { manager, chat };
}

describe('SessionManager', () => {
  const conversationId = 'conv_1';

  describe('withConversationLock / markTurnStarting（check-then-act 竞态互斥）', () => {
    it('并发获取按到达顺序串行执行', async () => {
      const { manager } = makeManager();
      const order: number[] = [];
      const gate1 = (() => {
        let resolve!: () => void;
        const p = new Promise<void>(r => (resolve = r));
        return { p, resolve };
      })();

      const first = manager
        .withConversationLock(conversationId, async () => {
          order.push(1);
          await gate1.p;
        })
        .then(() => order.push(3));
      const second = manager
        .withConversationLock(conversationId, async () => {
          order.push(2);
        })
        .then(() => order.push(4));

      await new Promise(r => setTimeout(r, 10));
      gate1.resolve();
      await Promise.all([first, second]);
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('前序失败不阻塞后续获取', async () => {
      const { manager } = makeManager();
      const first = manager.withConversationLock(conversationId, async () => {
        throw new Error('boom');
      });
      await expect(first).rejects.toThrow('boom');
      const ran = await manager.withConversationLock(
        conversationId,
        async () => 'ok',
      );
      expect(ran).toBe('ok');
    });

    it('markTurnStarting 让 hasActiveRuns 在 RunStarted 前的窗口内为真；registerRun 接管后清标记', () => {
      const { manager } = makeManager();
      expect(manager.hasActiveRuns(conversationId)).toBe(false);
      manager.markTurnStarting(conversationId, 'msg_a');
      expect(manager.hasActiveRuns(conversationId)).toBe(true);
      manager.registerRun(conversationId, 'msg_a', 'run_1');
      // run 已登记（session 内活跃），标记已清
      expect(manager.hasActiveRuns(conversationId)).toBe(true);
      manager.finalizeRun(conversationId, 'msg_a');
      expect(manager.hasActiveRuns(conversationId)).toBe(false);
    });
  });

  describe('initSession（连接生命周期——孤儿对账已移至启动期 OrphanRunReconciler）', () => {
    it('新会话：attach 传输(发 connected 握手) 并登记进程内会话状态，不对账孤儿、不重放 run_view', async () => {
      const { manager, chat } = makeManager([
        { id: 'msg_1', agentRunId: 'run_1' },
      ]);
      const transport = new FakeTransport();

      await manager.initSession(conversationId, transport);

      expect(chat.markMessagesTerminated).not.toHaveBeenCalled();
      expect(transport.sent).toEqual([{ type: 'connected' }]);
      expect(manager.getSessionState(conversationId)).toEqual({
        conversationId,
        startedAt: expect.any(Number),
      });
    });

    it('重连（connection 已存在）时保留既有会话状态，不重置 startedAt', async () => {
      const { manager } = makeManager([]);
      await manager.initSession(conversationId, new FakeTransport());
      const first = manager.getSessionState(conversationId);

      await manager.initSession(conversationId, new FakeTransport());

      expect(manager.getSessionState(conversationId)).toEqual(first);
    });

    it('disposeChat 后会话状态清空', async () => {
      const { manager } = makeManager([]);
      await manager.initSession(conversationId, new FakeTransport());
      expect(manager.getSessionState(conversationId)).not.toBeNull();

      manager.disposeChat(conversationId);

      expect(manager.getSessionState(conversationId)).toBeNull();
    });
  });

  describe('cancelAllActiveRuns（运行期取消：DB-only，不补发帧）', () => {
    it('activeRuns 为空时仍将孤儿 run 标记 cancelled，但不补发帧', async () => {
      const { manager, chat } = makeManager([]);
      const transport = new FakeTransport();
      await manager.initSession(conversationId, transport);

      // 模拟对账后才出现的孤儿（如 SSE 连不上、run 已死但 DB 仍 running）
      (
        chat.findActiveAssistantMessages as ReturnType<typeof vi.fn>
      ).mockResolvedValue([{ id: 'msg_orphan', agentRunId: 'run_orphan' }]);

      await manager.cancelAllActiveRuns(conversationId, 'Cancelled by user');

      expect(chat.markMessagesTerminated).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'msg_orphan' })],
        'cancelled',
        'Cancelled by user',
      );
      // 不再补发帧——前端经重连/重拉拿到终态。
      expect(
        transport.sent.find(f => (f.type as string) === 'cancelled'),
      ).toBeUndefined();
    });

    it('排除本进程仍活跃的 run（不打断在跑的 run）', async () => {
      const { manager, chat } = makeManager([]);
      await manager.initSession(conversationId, new FakeTransport());
      manager.registerRun(conversationId, 'msg_live', 'run_live');

      (
        chat.findActiveAssistantMessages as ReturnType<typeof vi.fn>
      ).mockResolvedValue([{ id: 'msg_live', agentRunId: 'run_live' }]);

      await manager.cancelAllActiveRuns(conversationId, 'x');

      expect(chat.markMessagesTerminated).not.toHaveBeenCalled();
    });
  });
});

describe('SessionManager.onShutdown（关停先 abort 活跃 run 再关池）', () => {
  function makeManagerWithDispatch(dispatch: (evt: never) => void): {
    manager: SessionManager;
    dispatch: ReturnType<typeof vi.fn>;
  } {
    const chat = {
      findActiveAssistantMessages: vi.fn().mockResolvedValue([]),
      markMessagesTerminated: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatService;
    const provider = {
      resolveContextSize: vi.fn().mockReturnValue(8000),
    } as unknown as ProviderService;
    const dispatchFn = vi.fn(dispatch);
    const manager = new SessionManager(
      chat,
      { publish: dispatchFn } as unknown as EventBus,
      provider,
      new StagePlan([]),
    );
    return { manager, dispatch: dispatchFn };
  }

  async function registerRun(
    manager: SessionManager,
    conversationId: string,
    messageId: string,
    runId: string,
  ): Promise<void> {
    await manager.initSession(conversationId, new FakeTransport());
    manager.registerRun(conversationId, messageId, runId);
  }

  it('跨会话所有活跃 run 都派发 CancelRun，等终态落库后关 SSE', async () => {
    // mock publish 模拟 run 同步 finalize——事件对象携带 conversationId+messageId。
    const { manager, dispatch } = makeManagerWithDispatch((evt: never) => {
      const payload = (evt as CancelRun).payload;
      manager.finalizeRun(payload.conversationId, payload.messageId);
    });
    await registerRun(manager, 'conv_1', 'msg_1', 'run_1');
    await registerRun(manager, 'conv_2', 'msg_2', 'run_2');

    await manager.onApplicationShutdown();

    const cancelled = dispatch.mock.calls
      .map(([evt]) => (evt as CancelRun).payload.runId)
      .filter(id => id.startsWith('run_'));
    expect(cancelled).toEqual(expect.arrayContaining(['run_1', 'run_2']));
    expect(manager.hasSession('conv_1')).toBe(false);
    expect(manager.hasSession('conv_2')).toBe(false);
  });

  it('stuck run 不观测 abort 时——宽限超时放行，仍关 SSE（余 reconciler 兜底）', async () => {
    const { manager, dispatch } = makeManagerWithDispatch(() => {});
    await registerRun(manager, 'conv_1', 'msg_1', 'run_1');
    manager.abortGraceMs = 40;

    const start = Date.now();
    await manager.onApplicationShutdown();
    const elapsed = Date.now() - start;

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cancel_run',
        payload: expect.objectContaining({ runId: 'run_1' }),
      }),
    );
    // 有界放行：不超过宽限 + slack；SSE 仍关。
    expect(elapsed).toBeLessThan(500);
    expect(manager.hasSession('conv_1')).toBe(false);
  });

  it('无活跃 run 时——onShutdown 立即返回不空等', async () => {
    const { manager } = makeManagerWithDispatch(() => {});
    const start = Date.now();
    await manager.onApplicationShutdown();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
