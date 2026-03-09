import { describe, it, expect, vi, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatSession } from '@/server/core/ChatSession';
import { PendingMessage } from '@/server/core/PendingMessage';
import type { SSEConnection } from '@/server/core/SSEConnection';
import type { Agent } from '@/server/core/agent';
import type { Memory } from '@/server/core/memory';
import { Role } from '@/shared/entities/Message';
import { InjectTokens } from '@/shared/constants';

const mockRedis = {
  setEx: () => Promise.resolve('OK'),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(1),
} as any;

try {
  container.resolve(InjectTokens.REDIS);
} catch {
  container.register(InjectTokens.REDIS, { useValue: mockRedis });
}

describe('ChatSession', () => {
  let session: ChatSession;
  let onDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDispose = vi.fn();
    session = new ChatSession('conv-123', {
      idleTimeoutMs: 30_000,
      onDispose,
    });
  });

  const makeMockConnection = (
    options: { writable?: boolean } = {},
  ): {
    conn: SSEConnection;
    sentMessages: unknown[];
  } => {
    const sentMessages: unknown[] = [];
    const mockResponse = {
      writable: options.writable ?? true,
      writableEnded: false,
      write: vi.fn((data: string) => {
        sentMessages.push(data);
        return options.writable ?? true;
      }),
      flush: vi.fn(),
      end: vi.fn(),
    };

    const conn = {
      conversationId: 'conv-123',
      get isWritable() {
        return mockResponse.writable;
      },
      send: vi.fn((msg: unknown) => {
        if (!mockResponse.writable) return false;
        mockResponse.write(`data: ${JSON.stringify(msg)}\n\n`);
        mockResponse.flush();
        return true;
      }),
      close: vi.fn(() => {
        mockResponse.writableEnded = true;
        mockResponse.end();
      }),
    } as unknown as SSEConnection;

    return { conn, sentMessages };
  };

  const makeMockAgent = (
    gen: (...args: any[]) => AsyncGenerator<any, void, void>,
  ): Agent =>
    ({
      id: 'test-agent',
      call: vi.fn().mockImplementation(gen),
    }) as unknown as Agent;

  const makeMockMessage = () => ({
    id: 'msg-123',
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as any[] },
    createdAt: new Date(),
    conversationId: 'conv-123',
  });

  const makeMockPersister = () => vi.fn().mockResolvedValue(undefined);

  const bindMockPendingMessage = (
    sess: ChatSession,
    message = makeMockMessage(),
    persister = makeMockPersister(),
  ) => {
    const pending = new PendingMessage(message, persister);
    sess.bindPendingMessage(pending);
    return { message, persister };
  };

  describe('initialization', () => {
    it('should initialize with waiting phase', () => {
      expect(session.phase).toBe('waiting');
      expect(session.conversationId).toBe('conv-123');
      expect(session.ctx).toBeNull();
    });
  });

  describe('run', () => {
    it('should transition to running then done', async () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
      const { persister } = bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        yield { type: 'start', seq: 1, at: Date.now() };
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      await session.run(agent, {} as Memory, {});

      expect(session.phase).toBe('done');
      expect(persister).toHaveBeenCalled();
    });

    it('should send events via SSE', async () => {
      const { conn, sentMessages } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        yield { type: 'start', seq: 1, at: Date.now() };
        yield {
          type: 'stream',
          content: 'Hello',
          seq: 2,
          at: Date.now(),
        };
        yield { type: 'final', seq: 3, at: Date.now() };
      });

      await session.run(agent, {} as Memory, {});

      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('should send cancelled event when aborted', async () => {
      const { conn, sentMessages } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        ctx.abort('Test abort');
        yield { type: 'start', seq: 1, at: Date.now() };
      });

      await session.run(agent, {} as Memory, {});

      const hasCancelled = sentMessages.some((msg: any) =>
        msg.includes('"type":"cancelled"'),
      );
      expect(hasCancelled).toBe(true);
    });

    it('should send error event when agent throws', async () => {
      const { conn, sentMessages } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        throw new Error('Agent error');
      });

      await session.run(agent, {} as Memory, {});

      const hasError = sentMessages.some((msg: any) =>
        msg.includes('"type":"error"'),
      );
      expect(hasError).toBe(true);
    });

    it('should abort when SSE not writable', async () => {
      const { conn } = makeMockConnection({ writable: false });
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        yield { type: 'start', seq: 1, at: Date.now() };
        yield {
          type: 'stream',
          content: 'Hello',
          seq: 2,
          at: Date.now(),
        };
        yield { type: 'final', seq: 3, at: Date.now() };
      });

      await session.run(agent, {} as Memory, {});

      expect(session.phase).toBe('done');
    });

    it('should break loop on error event', async () => {
      const { conn, sentMessages } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        yield { type: 'error', error: 'test', seq: 1, at: Date.now() };
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      await session.run(agent, {} as Memory, {});

      const hasFinal = sentMessages.some((msg: any) =>
        msg.includes('"type":"final"'),
      );
      expect(hasFinal).toBe(false);
    });

    it('should call persister even on error', async () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
      const { persister } = bindMockPendingMessage(session);

      const agent = makeMockAgent(async function* () {
        yield;
        throw new Error('fail');
      });

      await session.run(agent, {} as Memory, {});

      expect(persister).toHaveBeenCalled();
    });

    it('should throw if PendingMessage not bound', async () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);

      const agent = makeMockAgent(async function* () {
        yield { type: 'start', seq: 1, at: Date.now() };
      });

      await expect(session.run(agent, {} as Memory, {})).rejects.toThrow(
        'PendingMessage not bound',
      );
    });
  });

  describe('cancel', () => {
    it('should abort ctx when running', async () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      let capturedCtx: any;
      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        capturedCtx = ctx;
        yield { type: 'start', seq: 1, at: Date.now() };
        await new Promise(resolve => setTimeout(resolve, 50));
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      const runPromise = session.run(agent, {} as Memory, {});

      await new Promise(resolve => setTimeout(resolve, 10));
      session.cancel('User cancelled');

      await runPromise;

      expect(capturedCtx.signal.aborted).toBe(true);
    });

    it('should not abort if already aborted', () => {
      session.cancel('User cancelled');
    });
  });

  describe('handleDisconnect', () => {
    it('should cancel when phase is running', async () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
      bindMockPendingMessage(session);

      let capturedCtx: any;
      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        capturedCtx = ctx;
        yield { type: 'start', seq: 1, at: Date.now() };
        await new Promise(resolve => setTimeout(resolve, 50));
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      const runPromise = session.run(agent, {} as Memory, {});

      await new Promise(resolve => setTimeout(resolve, 10));
      session.handleDisconnect();

      await runPromise;

      expect(capturedCtx.signal.aborted).toBe(true);
    });

    it('should cleanup when phase is waiting', () => {
      session.handleDisconnect();

      expect(session.phase).toBe('done');
      expect(onDispose).toHaveBeenCalledWith('conv-123');
    });
  });

  describe('send', () => {
    it('should send event when connection is writable', () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);

      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(true);
    });

    it('should return false when connection is not writable', () => {
      const { conn } = makeMockConnection({ writable: false });
      session.bindConnection(conn);

      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });

    it('should return false when no connection', () => {
      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });

    it('should send control message when connection is writable', () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);

      session.send({
        type: 'session_error',
        error: 'Test error',
      });

      expect((conn as any).send).toHaveBeenCalled();
    });
  });

  describe('bindConnection', () => {
    it('should bind SSE connection', () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
    });
  });

  describe('cleanup', () => {
    it('should close the connection', () => {
      const { conn } = makeMockConnection();
      session.bindConnection(conn);
      session.cleanup();

      expect((conn as any).close).toHaveBeenCalled();
    });

    it('should be idempotent - done to done is ignored', () => {
      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1);

      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1);
    });
  });
});
