import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from '@/server/core/ChatSession';
import type { RunDeps } from '@/server/core/ChatSession';
import type { SSEConnection } from '@/server/service/SSEService';
import type { Agent } from '@/server/core/agent';
import type { Memory } from '@/server/core/memory';
import { Role } from '@/shared/entities/Message';

describe('ChatSession', () => {
  let session: ChatSession;
  let mockLogger: {
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let onDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    onDispose = vi.fn();
    session = new ChatSession('conv-123', {
      idleTimeoutMs: 30_000,
      logger: mockLogger as any,
      onDispose,
    });
  });

  const makeMockConnection = (
    overrides: Partial<SSEConnection> = {},
  ): SSEConnection => ({
    conversationId: 'conv-123',
    response: {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      flush: vi.fn(),
      writableEnded: false,
      end: vi.fn(),
    } as any,
    heartbeat: null as any,
    ...overrides,
  });

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
    meta: { events: [] },
    createdAt: new Date(),
    conversationId: 'conv-123',
  });

  const makeMockDeps = (): RunDeps => ({
    finalizeMessage: vi.fn().mockResolvedValue(undefined),
  });

  describe('initialization', () => {
    it('should initialize with waiting phase', () => {
      expect(session.phase).toBe('waiting');
      expect(session.conversationId).toBe('conv-123');
      expect(session.ctx).toBeNull();
    });
  });

  describe('run', () => {
    it('should transition to running then done', async () => {
      session.bindConnection(makeMockConnection());

      const agent = makeMockAgent(async function* () {
        yield { type: 'start', seq: 1, at: Date.now() };
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      const deps = makeMockDeps();
      await session.run(agent, {} as Memory, makeMockMessage(), {}, deps);

      expect(session.phase).toBe('done');
      expect(deps.finalizeMessage).toHaveBeenCalled();
    });

    it('should send events via SSE', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

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

      await session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      expect(conn.response.write).toHaveBeenCalled();
    });

    it('should send cancelled event when aborted', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        ctx.abort('Test abort');
        yield { type: 'start', seq: 1, at: Date.now() };
      });

      await session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      const writes = (conn.response.write as ReturnType<typeof vi.fn>).mock
        .calls;
      const hasCancelled = writes.some((call: any[]) =>
        call[0].includes('"type":"cancelled"'),
      );
      expect(hasCancelled).toBe(true);
    });

    it('should send error event when agent throws', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      const agent = makeMockAgent(async function* () {
        yield; // satisfy require-yield
        throw new Error('Agent error');
      });

      await session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      const writes = (conn.response.write as ReturnType<typeof vi.fn>).mock
        .calls;
      const hasError = writes.some((call: any[]) =>
        call[0].includes('"type":"error"'),
      );
      expect(hasError).toBe(true);
    });

    it('should abort when SSE not writable', async () => {
      const conn = makeMockConnection({
        response: {
          writable: false,
          writableEnded: false,
          end: vi.fn(),
        } as any,
      });
      session.bindConnection(conn);

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

      await session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      expect(session.phase).toBe('done');
    });

    it('should break loop on error event', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      const agent = makeMockAgent(async function* () {
        yield { type: 'error', error: 'test', seq: 1, at: Date.now() };
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      await session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      const writes = (conn.response.write as ReturnType<typeof vi.fn>).mock
        .calls;
      const hasFinal = writes.some((call: any[]) =>
        call[0].includes('"type":"final"'),
      );
      expect(hasFinal).toBe(false);
    });

    it('should call finalizeMessage even on error', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      const agent = makeMockAgent(async function* () {
        yield;
        throw new Error('fail');
      });

      const deps = makeMockDeps();
      await session.run(agent, {} as Memory, makeMockMessage(), {}, deps);

      expect(deps.finalizeMessage).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should abort ctx when running', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      let capturedCtx: any;
      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        capturedCtx = ctx;
        yield { type: 'start', seq: 1, at: Date.now() };
        // Simulate waiting
        await new Promise(resolve => setTimeout(resolve, 50));
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      const runPromise = session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

      // Wait for agent to start
      await new Promise(resolve => setTimeout(resolve, 10));
      session.cancel('User cancelled');

      await runPromise;

      expect(capturedCtx.signal.aborted).toBe(true);
    });

    it('should not abort if already aborted', () => {
      // No ctx → should not throw
      session.cancel('User cancelled');
    });
  });

  describe('handleDisconnect', () => {
    it('should cancel when phase is running', async () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      let capturedCtx: any;
      const agent = makeMockAgent(async function* (_mem: any, ctx: any) {
        capturedCtx = ctx;
        yield { type: 'start', seq: 1, at: Date.now() };
        await new Promise(resolve => setTimeout(resolve, 50));
        yield { type: 'final', seq: 2, at: Date.now() };
      });

      const runPromise = session.run(
        agent,
        {} as Memory,
        makeMockMessage(),
        {},
        makeMockDeps(),
      );

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

  describe('sendEvent', () => {
    it('should send event when connection is writable', () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.sendEvent(event);

      expect(result).toBe(true);
      expect(conn.response.write).toHaveBeenCalled();
      expect(conn.response.flush).toHaveBeenCalled();
    });

    it('should return false when connection is not writable', () => {
      const conn = makeMockConnection({
        response: { writable: false } as any,
      });
      session.bindConnection(conn);

      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.sendEvent(event);

      expect(result).toBe(false);
    });

    it('should return false when no connection', () => {
      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.sendEvent(event);

      expect(result).toBe(false);
    });
  });

  describe('sendControlMessage', () => {
    it('should send control message when connection is writable', () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);

      session.sendControlMessage({
        type: 'session_error',
        error: 'Test error',
      });

      expect(conn.response.write).toHaveBeenCalled();
    });
  });

  describe('bindConnection', () => {
    it('should bind SSE connection', () => {
      const conn = makeMockConnection();
      session.bindConnection(conn);
      // Should not throw
    });
  });

  describe('cleanup', () => {
    it('should clear heartbeat interval and end response', () => {
      vi.useFakeTimers();
      const mockEnd = vi.fn();
      const conn = makeMockConnection({
        response: { writableEnded: false, end: mockEnd } as any,
        heartbeat: setInterval(() => {}, 1000),
      });

      session.bindConnection(conn);
      session.cleanup();

      expect(mockEnd).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should not end response if already ended', () => {
      const mockEnd = vi.fn();
      const conn = makeMockConnection({
        response: { writableEnded: true, end: mockEnd } as any,
      });

      session.bindConnection(conn);
      session.cleanup();

      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('should be idempotent - done to done is ignored', () => {
      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1);

      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1);
    });
  });
});
