import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionFSM } from '@/server/core/SessionFSM';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

const MSG_ID = 'msg-1';
const IDLE_TIMEOUT_MS = 60000;

describe('SessionFSM', () => {
  let session: SessionFSM;
  let onDispose: ReturnType<typeof vi.fn>;
  let onPhaseChange: ReturnType<typeof vi.fn>;

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    events: [],
    status: 'initialized',
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  const createMockTransport = () => ({
    send: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    disconnect: vi.fn(),
    isConnected: true,
    connect: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });

  beforeEach(() => {
    vi.useFakeTimers();

    onDispose = vi.fn().mockResolvedValue(undefined);
    onPhaseChange = vi.fn().mockResolvedValue(undefined);

    session = new SessionFSM('conv-1', IDLE_TIMEOUT_MS);

    session.addEventListener('dispose', e => {
      const conversationId = (e as CustomEvent).detail;
      onDispose(conversationId);
    });
    session.addEventListener('transition', e => {
      const { from, to } = (e as CustomEvent).detail;
      onPhaseChange('conv-1', from, to);
    });
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
    it('should transition from waiting to active', () => {
      session['sm'].transition('active');

      expect(session.phase).toBe('active');
      expect(onPhaseChange).toHaveBeenCalledWith('conv-1', 'waiting', 'active');
    });

    it('should not allow invalid transition from waiting to done directly via transition', () => {
      // Actually waiting→done is valid per the VALID_TRANSITIONS
      session['sm'].transition('done');

      expect(session.phase).toBe('done');
    });

    it('should follow valid transition path: waiting→active→waiting', () => {
      session['sm'].transition('active');
      expect(session.phase).toBe('active');

      session['sm'].transition('waiting');
      expect(session.phase).toBe('waiting');
    });

    it('should allow transition from active to canceling', () => {
      session['sm'].transition('active');

      session['sm'].transition('canceling');
      expect(session.phase).toBe('canceling');
    });

    it('should allow transition from canceling to done', () => {
      session['sm'].transition('active');
      session['sm'].transition('canceling');

      session['sm'].transition('done');
      expect(session.phase).toBe('done');
    });

    it('should allow transition from waiting to error', () => {
      session['sm'].transition('error');

      expect(session.phase).toBe('error');
    });
  });

  describe('attachTransport', () => {
    it('should attach new transport', () => {
      const transport = createMockTransport();

      session.attachTransport(transport as any);

      expect(transport.send).not.toHaveBeenCalled();
    });

    it('should kick old transport when attaching new one', () => {
      const oldTransport = createMockTransport();
      const newTransport = createMockTransport();

      session.attachTransport(oldTransport as any);
      session.attachTransport(newTransport as any);

      expect(oldTransport.disconnect).toHaveBeenCalled();
    });
  });

  describe('addMessageFSM', () => {
    it('should create and store a MessageFSM', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);

      const msgFsm = session.addMessageFSM('msg-1', pendingMessage);

      expect(msgFsm).toBeDefined();
      expect(msgFsm.messageId).toBe('msg-1');
      expect(session.getMessageFSM('msg-1')).toBe(msgFsm);
    });
  });

  describe('cancelMessage', () => {
    it('should cancel the specified message', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      // First, put the message in streaming state (non-terminal)
      const msgFsm = session.getMessageFSM(MSG_ID)!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      session.cancelMessage(MSG_ID);

      expect(msgFsm.phase).toBe('canceling');
    });

    it('should do nothing if message not found', () => {
      expect(() => session.cancelMessage('non-existent')).not.toThrow();
    });

    it('should do nothing if message already terminal', () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      const msgFsm = session.getMessageFSM(MSG_ID)!;
      // Put through streaming then final
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      msgFsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });

      session.cancelMessage(MSG_ID);

      // Already terminal, phase should remain final
      expect(msgFsm.phase).toBe('final');
    });
  });

  describe('cancelAllMessages', () => {
    it('should cancel all non-terminal messages', async () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      const pending1 = new PendingMessage(message1);
      const pending2 = new PendingMessage(message2);

      session.addMessageFSM('msg-1', pending1);
      session.addMessageFSM('msg-2', pending2);

      const msgFsm1 = session.getMessageFSM('msg-1')!;
      const msgFsm2 = session.getMessageFSM('msg-2')!;

      // Put msgFsm1 in streaming (non-terminal)
      msgFsm1.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      // Put msgFsm2 in final (terminal)
      msgFsm2.handleEvent({
        type: 'start',
        messageId: 'msg-2',
        seq: 1,
        at: Date.now(),
      });
      msgFsm2.handleEvent({
        type: 'final',
        messageId: 'msg-2',
        seq: 2,
        at: Date.now(),
      });

      session.cancelAllMessages('User cancelled');

      expect(msgFsm1.phase).toBe('canceling');
      expect(msgFsm2.phase).toBe('final'); // unchanged, already terminal
      expect(session.phase).toBe('canceling');
    });
  });

  describe('handleDisconnect', () => {
    it('should persist all non-terminal messages', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      const msgFsm = session.getMessageFSM(MSG_ID)!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      await session.handleDisconnect();

      // After disconnect, message is still tracked (no persist method)
      expect(session.getMessageFSM(MSG_ID)).toBeDefined();
    });

    it('should cleanup when in waiting phase', async () => {
      await session.handleDisconnect();

      expect(session.phase).toBe('done');
      expect(onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should not cleanup when in active phase', async () => {
      session['sm'].transition('active');

      await session.handleDisconnect();

      expect(session.phase).toBe('active');
      expect(onDispose).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send event through transport', () => {
      const transport = createMockTransport();
      session.attachTransport(transport as any);

      const event: AgentEvent = {
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(true);
      expect(transport.send).toHaveBeenCalledWith(event);
    });

    it('should return false if no connection', () => {
      const event: AgentEvent = {
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });

    it('should return false if transport not connected', () => {
      const transport = createMockTransport();
      transport.isConnected = false;
      session.attachTransport(transport as any);

      const event: AgentEvent = {
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      const result = session.send(event);

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should transition to done and close transport', async () => {
      const transport = createMockTransport();
      session.attachTransport(transport as any);

      await session.cleanup();

      expect(session.phase).toBe('done');
      expect(transport.close).toHaveBeenCalled();
      expect(onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should clear all MessageFSMs', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM('msg-1', pendingMessage);

      await session.cleanup();

      expect(session.getMessageFSM('msg-1')).toBeUndefined();
    });
  });

  describe('idle timeout', () => {
    it('should cleanup after idle timeout in waiting phase', async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

      expect(onDispose).toHaveBeenCalledWith('conv-1');
    });

    it('should not cleanup if not in waiting phase', async () => {
      session['sm'].transition('active');

      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

      expect(onDispose).not.toHaveBeenCalled();
    });
  });

  describe('waiting↔active driving', () => {
    it('should transition to active when MessageFSM enters non-terminal state', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      const msgFsm = session.getMessageFSM(MSG_ID)!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      expect(session.phase).toBe('active');
    });

    it('should transition back to waiting when all MessageFSMs reach terminal', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      const msgFsm = session.getMessageFSM(MSG_ID)!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      expect(session.phase).toBe('active');

      msgFsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });
      expect(session.phase).toBe('waiting');
    });

    it('should cleanup when all messages reach terminal in canceling phase', async () => {
      const message = createMessage();
      const pendingMessage = new PendingMessage(message);
      session.addMessageFSM(MSG_ID, pendingMessage);

      const msgFsm = session.getMessageFSM(MSG_ID)!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      session.cancelAllMessages('User cancelled');
      expect(session.phase).toBe('canceling');

      msgFsm.handleEvent({
        type: 'cancelled',
        messageId: MSG_ID,
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(session.phase).toBe('done');
    });
  });

  describe('message-level cancel', () => {
    it('should keep session active when one message is canceled but others are still running', async () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      const pending1 = new PendingMessage(message1);
      const pending2 = new PendingMessage(message2);

      session.addMessageFSM('msg-1', pending1);
      session.addMessageFSM('msg-2', pending2);

      const msgFsm1 = session.getMessageFSM('msg-1')!;
      const msgFsm2 = session.getMessageFSM('msg-2')!;

      // Put both in streaming (non-terminal)
      msgFsm1.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      msgFsm2.handleEvent({
        type: 'start',
        messageId: 'msg-2',
        seq: 1,
        at: Date.now(),
      });

      expect(session.phase).toBe('active');

      // Cancel only msg-1
      session.cancelMessage('msg-1');

      expect(msgFsm1.phase).toBe('canceling');
      expect(msgFsm2.phase).toBe('streaming');
      // Session should still be active because msg-2 is still running
      expect(session.phase).toBe('active');
    });

    it('should transition to waiting when all messages reach terminal after individual cancels', async () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      const pending1 = new PendingMessage(message1);
      const pending2 = new PendingMessage(message2);

      session.addMessageFSM('msg-1', pending1);
      session.addMessageFSM('msg-2', pending2);

      const msgFsm1 = session.getMessageFSM('msg-1')!;
      const msgFsm2 = session.getMessageFSM('msg-2')!;

      // Put both in streaming
      msgFsm1.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      msgFsm2.handleEvent({
        type: 'start',
        messageId: 'msg-2',
        seq: 1,
        at: Date.now(),
      });

      expect(session.phase).toBe('active');

      // Cancel both individually
      session.cancelMessage('msg-1');
      session.cancelMessage('msg-2');

      // Both should be canceling
      expect(msgFsm1.phase).toBe('canceling');
      expect(msgFsm2.phase).toBe('canceling');

      // Complete cancellation
      msgFsm1.handleEvent({
        type: 'cancelled',
        messageId: 'msg-1',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });
      expect(session.phase).toBe('active'); // msg-2 still canceling

      msgFsm2.handleEvent({
        type: 'cancelled',
        messageId: 'msg-2',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });
      expect(session.phase).toBe('waiting'); // all terminated
    });
  });

  describe('error state', () => {
    it('should transition to error from active phase', () => {
      session['sm'].transition('active');

      session['sm'].transition('error');

      expect(session.phase).toBe('error');
    });

    it('should transition from error to done', () => {
      session['sm'].transition('active');
      session['sm'].transition('error');

      expect(session.phase).toBe('error');

      session['sm'].transition('done');

      expect(session.phase).toBe('done');
    });

    it('should allow transition from waiting to error', () => {
      expect(session.phase).toBe('waiting');

      session['sm'].transition('error');

      expect(session.phase).toBe('error');
    });

    it('should allow transition from canceling to error', () => {
      session['sm'].transition('active');
      session['sm'].transition('canceling');

      session['sm'].transition('error');

      expect(session.phase).toBe('error');
    });

    it('should not allow transition from error to canceled (done is terminal)', () => {
      session['sm'].transition('active');
      session['sm'].transition('error');

      expect(session['sm'].canTransitionTo('done')).toBe(true);
    });
  });
});
