import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { RedisService } from '@/server/libs/infrastructure/redis.service';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { EventBus } from '@/server/libs/ddd';
import { Transport } from '@/shared/transport';
import type { SSEFrame } from '@/shared/types/events';

/** 记录所有 send 帧的最小 Transport 实现。 */
class FakeTransport extends Transport<SSEFrame> {
  sent: SSEFrame[] = [];
  private connected = true;

  async connect(): Promise<void> {}
  disconnect(): void {}
  send(frame: SSEFrame): boolean {
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

function makeMockRedis(): RedisService {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisService;
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
  redis: RedisService;
} {
  const redis = makeMockRedis();
  const chat = makeMockChat(activeMessages);
  const manager = new SessionManager(redis, chat, {
    dispatch: vi.fn(),
  } as unknown as EventBus);
  return { manager, chat, redis };
}

describe('SessionManager', () => {
  const conversationId = 'conv_1';

  describe('initSession（连接生命周期——孤儿对账已移至启动期 OrphanRunReconciler）', () => {
    it('新会话：attach 传输并登记 redis key，不对账孤儿、不补发帧', async () => {
      const { manager, chat, redis } = makeManager([
        { id: 'msg_1', agentRunId: 'run_1' },
      ]);
      const transport = new FakeTransport();

      await manager.initSession(conversationId, transport);

      expect(chat.markMessagesTerminated).not.toHaveBeenCalled();
      expect(transport.sent).toHaveLength(0);
      expect(redis.set).toHaveBeenCalledWith(
        `chat_session:${conversationId}`,
        expect.any(Object),
        3600,
      );
    });

    it('重连（connection 已存在）时跳过 redis 登记', async () => {
      const { manager, redis } = makeManager([]);
      await manager.initSession(conversationId, new FakeTransport());
      (redis.set as ReturnType<typeof vi.fn>).mockClear();

      await manager.initSession(conversationId, new FakeTransport());

      expect(redis.set).not.toHaveBeenCalled();
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
