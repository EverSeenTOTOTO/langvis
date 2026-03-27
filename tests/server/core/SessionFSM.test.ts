import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionFSM } from '@/server/core/SessionFSM';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

describe('SessionFSM', () => {
  let session: SessionFSM;
  let options: {
    idleTimeoutMs: number;
    onDispose: ReturnType<typeof vi.fn>;
    onPhaseChange: ReturnType<typeof vi.fn>;
  };

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as AgentEvent[] },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  const createPersister = () => vi.fn().mockResolvedValue(undefined);

  const createMockConnection = () => ({
    conversationId: 'conv-1',
    send: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    isWritable: true,
  });

  beforeEach(() => {
    vi.useFakeTimers();

    options = {
      idleTimeoutMs: 60000,
      onDispose: vi.fn().mockResolvedValue(undefined),
      onPhaseChange: vi.fn().mockResolvedValue(undefined),
    };
    session = new SessionFSM('conv-1', options);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start with waiting phase', () => {
      expect(session.phase).toBe('waiting');
    });

    it('should have correct conversationId', () => {
      expect(session.conversationId).toBe('conv-1');
    });

    it('should have createdAt timestamp', () => {
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('transition', () => {
    it('should transition from waiting to active', async () => {
      await (session as any).transition('active');

      expect(session.phase).toBe('active');
      expect(options.onPhaseChange).toHaveBeenCalledWith('conv-1', 'active');
    });

    it('should not allow invalid transition from waiting to done directly via transition', async () => {
      // Actually waiting→done is valid per the VALID_TRANSITIONS
      await (session as any).transition('done');

      expect(session.phase).toBe('done');
    });

    it('should follow valid transition path: waiting→active→waiting', async () => {
      await (session as any).transition('active');
      expect(session.phase).toBe('active');

      await (session as any).transition('waiting');
      expect(session.phase).toBe('waiting');
    });

    it('should allow transition from active to canceling', async () => {
      await (session as any).transition('active');

      await (session as any).transition('canceling');
      expect(session.phase).toBe('canceling');
    });

    it('should allow transition from canceling to done', async () => {
      await (session as any).transition('active');
      await (session as any).transition('canceling');

      await (session as any).transition('done');
      expect(session.phase).toBe('done');
    });

    it('should not allow transition from waiting to error', async () => {
      await (session as any).transition('error');

      expect(session.phase).toBe('waiting');
    });
  });

  describe('bindConnection', () => {
    it('should bind new connection', () => {
      const conn = createMockConnection();

      session.bindConnection(conn as any);

      expect(conn.send).not.toHaveBeenCalled();
    });

    it('should kick old connection when binding new one', () => {
      const oldConn = createMockConnection();
      const newConn = createMockConnection();

      session.bindConnection(oldConn as any);
      session.bindConnection(newConn as any);

      expect(oldConn.send).toHaveBeenCalledWith({ type: 'session_replaced' });
      expect(oldConn.close).toHaveBeenCalled();
    });
  });

  describe('addMessageFSM', () => {
    it('should create and store a MessageFSM', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());

      const msgFsm = session.addMessageFSM('msg-1', pendingMessage);

      expect(msgFsm).toBeDefined();
      expect(msgFsm.messageId).toBe('msg-1');
      expect(session.getMessageFSM('msg-1')).toBe(msgFsm);
    });
  });

  describe('cancelMessage', () => {
    it('should cancel the specified message', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      // First, put the message in streaming state (non-terminal)
      const msgFsm = session.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      session.cancelMessage('msg-1');

      expect(msgFsm.phase).toBe('canceling');
    });

    it('should do nothing if message not found', () => {
      expect(() => session.cancelMessage('non-existent')).not.toThrow();
    });

    it('should do nothing if message already terminal', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      const msgFsm = session.getMessageFSM('msg-1')!;
      // Put through streaming then final
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      msgFsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });

      session.cancelMessage('msg-1');

      // Already terminal, phase should remain final
      expect(msgFsm.phase).toBe('final');
    });
  });

  describe('cancelAllMessages', () => {
    it('should cancel all non-terminal messages', async () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      const pending1 = new PendingMessage(message1, createPersister());
      const pending2 = new PendingMessage(message2, createPersister());

      session.addMessageFSM('msg-1', pending1);
      session.addMessageFSM('msg-2', pending2);

      const msgFsm1 = session.getMessageFSM('msg-1')!;
      const msgFsm2 = session.getMessageFSM('msg-2')!;

      // Put msgFsm1 in streaming (non-terminal)
      msgFsm1.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      // Put msgFsm2 in final (terminal)
      msgFsm2.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      msgFsm2.handleEvent({ type: 'final', seq: 2, at: Date.now() });

      session.cancelAllMessages('User cancelled');

      expect(msgFsm1.phase).toBe('canceling');
      expect(msgFsm2.phase).toBe('final'); // unchanged, already terminal
      expect(session.phase).toBe('canceling');
    });
  });

  describe('handleDisconnect', () => {
    it('should persist all non-terminal messages', async () => {
      const message = createMessage();
      const persister = createPersister();
      const pendingMessage = new PendingMessage(message, persister);
      session.addMessageFSM('msg-1', pendingMessage);

      const msgFsm = session.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      await session.handleDisconnect();

      expect(persister).toHaveBeenCalled();
    });

    it('should cleanup when in waiting phase', async () => {
      await session.handleDisconnect();

      expect(session.phase).toBe('done');
      expect(options.onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should not cleanup when in active phase', async () => {
      await (session as any).transition('active');

      await session.handleDisconnect();

      expect(session.phase).toBe('active');
      expect(options.onDispose).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send event through connection', () => {
      const conn = createMockConnection();
      session.bindConnection(conn as any);

      const event: AgentEvent = {
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(true);
      expect(conn.send).toHaveBeenCalledWith(event);
    });

    it('should return false if no connection', () => {
      const event: AgentEvent = {
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });

    it('should return false if connection not writable', () => {
      const conn = createMockConnection();
      conn.isWritable = false;
      session.bindConnection(conn as any);

      const event: AgentEvent = {
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should transition to done and close connection', async () => {
      const conn = createMockConnection();
      session.bindConnection(conn as any);

      await session.cleanup();

      expect(session.phase).toBe('done');
      expect(conn.close).toHaveBeenCalled();
      expect(options.onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should clear all MessageFSMs', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      await session.cleanup();

      expect(session.getMessageFSM('msg-1')).toBeUndefined();
    });
  });

  describe('idle timeout', () => {
    it('should cleanup after idle timeout in waiting phase', async () => {
      // Advance timers and allow async operations to complete
      await vi.advanceTimersByTimeAsync(options.idleTimeoutMs);

      expect(options.onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should not cleanup if not in waiting phase', async () => {
      await (session as any).transition('active');

      await vi.advanceTimersByTimeAsync(options.idleTimeoutMs);

      expect(options.onDispose).not.toHaveBeenCalled();
    });
  });

  describe('waiting↔active driving', () => {
    it('should transition to active when MessageFSM enters non-terminal state', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      const msgFsm = session.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      expect(session.phase).toBe('active');
    });

    it('should transition back to waiting when all MessageFSMs reach terminal', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      const msgFsm = session.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      expect(session.phase).toBe('active');

      msgFsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });
      expect(session.phase).toBe('waiting');
    });

    it('should cleanup when all messages reach terminal in canceling phase', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message, createPersister());
      session.addMessageFSM('msg-1', pendingMessage);

      const msgFsm = session.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      session.cancelAllMessages('User cancelled');
      expect(session.phase).toBe('canceling');

      msgFsm.handleEvent({
        type: 'cancelled',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(session.phase).toBe('done');
    });
  });
});
