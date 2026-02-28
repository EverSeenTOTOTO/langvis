import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from '@/server/core/ChatSession';
import type { SSEConnection } from '@/server/service/SSEService';
import type { Response } from 'express';

describe('ChatSession', () => {
  let session: ChatSession;
  let mockLogger: { warn: ReturnType<typeof vi.fn> };
  let onDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = { warn: vi.fn() };
    onDispose = vi.fn();
    session = new ChatSession('conv-123', {
      idleTimeoutMs: 30_000,
      logger: mockLogger as any,
      onDispose,
    });
  });

  describe('initialization', () => {
    it('should initialize with waiting phase', () => {
      expect(session.phase).toBe('waiting');
      expect(session.conversationId).toBe('conv-123');
      expect(session.ctx).toBeNull();
    });
  });

  describe('phase transitions', () => {
    it('should transition from waiting to running', () => {
      const mockCtx = {} as any;
      session.start(mockCtx);

      expect(session.phase).toBe('running');
      expect(session.ctx).toBe(mockCtx);
    });

    it('should transition from waiting to done via cleanup', () => {
      session.cleanup();

      expect(session.phase).toBe('done');
      expect(onDispose).toHaveBeenCalledWith('conv-123');
    });

    it('should transition from running to done via cleanup', () => {
      const mockCtx = {} as any;
      session.start(mockCtx);
      session.cleanup();

      expect(session.phase).toBe('done');
      expect(onDispose).toHaveBeenCalledWith('conv-123');
    });

    it('should be idempotent - done to done is ignored', () => {
      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1);

      session.cleanup();
      expect(onDispose).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('cancel', () => {
    it('should abort ctx when running', () => {
      const mockAbort = vi.fn();
      const mockCtx = {
        abort: mockAbort,
        signal: { aborted: false },
      } as any;

      session.start(mockCtx);
      session.cancel('User cancelled');

      expect(mockAbort).toHaveBeenCalledWith('User cancelled');
    });

    it('should not abort if already aborted', () => {
      const mockAbort = vi.fn();
      const mockCtx = {
        abort: mockAbort,
        signal: { aborted: true },
      } as any;

      session.start(mockCtx);
      session.cancel('User cancelled');

      expect(mockAbort).not.toHaveBeenCalled();
    });

    it('should do nothing if no ctx', () => {
      session.cancel('User cancelled');
      // Should not throw
    });
  });

  describe('onClientDisconnect', () => {
    it('should cancel when phase is running', () => {
      const mockAbort = vi.fn();
      const mockCtx = {
        abort: mockAbort,
        signal: { aborted: false },
      } as any;

      session.start(mockCtx);
      session.onClientDisconnect();

      expect(mockAbort).toHaveBeenCalledWith('Client disconnected');
      expect(session.phase).toBe('running'); // cleanup not called yet
    });

    it('should cleanup when phase is waiting', () => {
      session.onClientDisconnect();

      expect(session.phase).toBe('done');
      expect(onDispose).toHaveBeenCalledWith('conv-123');
    });
  });

  describe('sendEvent', () => {
    it('should send event when connection is writable', () => {
      const mockWrite = vi.fn().mockReturnValue(true);
      const mockFlush = vi.fn();
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: { writable: true, write: mockWrite, flush: mockFlush } as any,
        heartbeat: null as any,
      };

      session.bindConnection(mockConnection);
      const event = {
        type: 'stream' as const,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.sendEvent(event);

      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalled();
      expect(mockFlush).toHaveBeenCalled();
    });

    it('should return false when connection is not writable', () => {
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: { writable: false } as any,
        heartbeat: null as any,
      };

      session.bindConnection(mockConnection);
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
      const mockWrite = vi.fn().mockReturnValue(true);
      const mockFlush = vi.fn();
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: { writable: true, write: mockWrite, flush: mockFlush } as any,
        heartbeat: null as any,
      };

      session.bindConnection(mockConnection);
      session.sendControlMessage({
        type: 'session_error',
        error: 'Test error',
      });

      expect(mockWrite).toHaveBeenCalled();
    });
  });

  describe('bindConnection', () => {
    it('should bind SSE connection', () => {
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: {} as Response,
        heartbeat: null as any,
      };

      session.bindConnection(mockConnection);

      // Should not throw, connection is stored internally
    });
  });

  describe('cleanup', () => {
    it('should clear heartbeat interval and end response', () => {
      vi.useFakeTimers();
      const mockEnd = vi.fn();
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: { writableEnded: false, end: mockEnd } as any,
        heartbeat: setInterval(() => {}, 1000),
      };

      session.bindConnection(mockConnection);
      session.cleanup();

      expect(mockEnd).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should not end response if already ended', () => {
      const mockEnd = vi.fn();
      const mockConnection: SSEConnection = {
        conversationId: 'conv-123',
        response: { writableEnded: true, end: mockEnd } as any,
        heartbeat: null as any,
      };

      session.bindConnection(mockConnection);
      session.cleanup();

      expect(mockEnd).not.toHaveBeenCalled();
    });
  });
});
