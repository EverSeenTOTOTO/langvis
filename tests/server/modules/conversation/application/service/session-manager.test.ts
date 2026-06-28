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

describe('SessionManager — 孤儿 run 对账', () => {
  const conversationId = 'conv_1';

  describe('initSession（重连对账）', () => {
    it('将孤儿 run 标记 failed 并向客户端补发 error 帧', async () => {
      const { manager, chat, redis } = makeManager([
        { id: 'msg_1', agentRunId: 'run_1' },
      ]);
      const transport = new FakeTransport();

      await manager.initSession(conversationId, transport);

      expect(chat.markMessagesTerminated).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'msg_1' })],
        'failed',
        'Generation interrupted (server restarted)',
      );

      const errorFrame = transport.sent.find(
        f =>
          f.type === 'error' &&
          (f as { messageId?: string }).messageId === 'msg_1',
      );
      expect(errorFrame).toEqual(
        expect.objectContaining({
          type: 'error',
          messageId: 'msg_1',
          runId: 'run_1',
          error: 'Generation interrupted (server restarted)',
        }),
      );

      expect(redis.set).toHaveBeenCalledWith(
        `chat_session:${conversationId}`,
        expect.any(Object),
        3600,
      );
    });

    it('无孤儿时不标记、不补发，但仍登记新会话', async () => {
      const { manager, chat, redis } = makeManager([]);
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

    it('排除本进程仍活跃的 run（断线重连不打断在跑的 run）', async () => {
      const { manager, chat } = makeManager([
        { id: 'msg_live', agentRunId: 'run_live' },
      ]);
      manager.registerRun(conversationId, 'msg_live', 'run_live');

      await manager.initSession(conversationId, new FakeTransport());

      expect(chat.markMessagesTerminated).not.toHaveBeenCalled();
    });

    it('重连（connection 已存在）时跳过对账', async () => {
      const { manager, chat } = makeManager([
        { id: 'msg_1', agentRunId: 'run_1' },
      ]);

      await manager.initSession(conversationId, new FakeTransport());

      (
        chat.findActiveAssistantMessages as ReturnType<typeof vi.fn>
      ).mockClear();
      (chat.markMessagesTerminated as ReturnType<typeof vi.fn>).mockClear();
      const second = new FakeTransport();
      await manager.initSession(conversationId, second);

      expect(chat.findActiveAssistantMessages).not.toHaveBeenCalled();
      expect(chat.markMessagesTerminated).not.toHaveBeenCalled();
      expect(second.sent).toHaveLength(0);
    });
  });

  describe('cancelAllActiveRuns（取消对账）', () => {
    it('activeRuns 为空时仍将孤儿 run 标记 cancelled 并补发 cancelled 帧', async () => {
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

      const cancelledFrame = transport.sent.find(
        f =>
          f.type === 'cancelled' &&
          (f as { messageId?: string }).messageId === 'msg_orphan',
      );
      expect(cancelledFrame).toEqual(
        expect.objectContaining({
          type: 'cancelled',
          messageId: 'msg_orphan',
          reason: 'Cancelled by user',
        }),
      );
    });
  });
});
