import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFSM } from '@/server/core/MessageFSM';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

describe('MessageFSM (server)', () => {
  let message: Message;
  let persister: ReturnType<typeof vi.fn>;
  let pendingMessage: PendingMessage;
  let onPhaseChange: ReturnType<typeof vi.fn>;

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as AgentEvent[] },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    message = createMessage();
    persister = vi.fn().mockResolvedValue(undefined);
    pendingMessage = new PendingMessage(message, persister);
    onPhaseChange = vi.fn().mockResolvedValue(undefined);
  });

  describe('initial state', () => {
    it('should start with initialized phase', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      expect(fsm.phase).toBe('initialized');
      expect(fsm.messageId).toBe('msg-1');
    });

    it('should not be terminal initially', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      expect(fsm.isTerminal).toBe(false);
    });

    it('should return message from pendingMessage', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      expect(fsm.message).toBe(message);
    });
  });

  describe('handleEvent - state transitions', () => {
    it('should transition from initialized to streaming on start event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      expect(fsm.phase).toBe('streaming');
      expect(onPhaseChange).toHaveBeenCalledWith('msg-1', 'streaming');
    });

    it('should transition from initialized to streaming on stream event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from initialized to streaming on thought event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.handleEvent({
        type: 'thought',
        content: 'Thinking...',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from initialized to streaming on tool_call event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.handleEvent({
        type: 'tool_call',
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should stay in streaming on subsequent events', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({
        type: 'tool_call',
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: {},
        seq: 3,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');
    });

    it('should transition to final on final event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      fsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminal).toBe(true);
    });

    it('should transition to canceled on cancelled event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      fsm.handleEvent({
        type: 'cancelled',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminal).toBe(true);
    });

    it('should transition to error on error event', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      fsm.handleEvent({
        type: 'error',
        error: 'Something went wrong',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminal).toBe(true);
    });
  });

  describe('handleEvent - awaiting_input', () => {
    it('should transition to awaiting_input on tool_progress with awaiting_input status', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      fsm.handleEvent({
        type: 'tool_progress',
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: { type: 'string' } },
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('awaiting_input');
    });
  });

  describe('handleEvent - content delegation', () => {
    it('should delegate stream content to PendingMessage', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'stream',
        content: ' World',
        seq: 2,
        at: Date.now(),
      });

      expect(message.content).toBe('Hello World');
    });

    it('should delegate events to PendingMessage', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      fsm.handleEvent({
        type: 'tool_call',
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 2,
        at: Date.now(),
      });

      expect(message.meta!.events).toHaveLength(2);
    });
  });

  describe('cancel', () => {
    it('should transition to canceling from initialized', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from streaming', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      fsm.handleEvent({
        type: 'tool_progress',
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should not cancel from terminal state', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      fsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });
      expect(fsm.phase).toBe('final');

      fsm.cancel();

      // Already terminal, should stay final
      expect(fsm.phase).toBe('final');
    });

    it('should not cancel from canceling state', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });
      fsm.cancel();

      fsm.cancel(); // Second cancel

      expect(onPhaseChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('finalize', () => {
    it('should persist the message', async () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      fsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });

      const ctx = {
        signal: { aborted: false, reason: null },
        agentCancelledEvent: vi.fn(),
      } as any;

      await fsm.finalize(ctx);

      expect(persister).toHaveBeenCalled();
    });

    it('should add cancelled event and transition to canceled if aborted', async () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      const abortController = new AbortController();
      abortController.abort('User cancelled');

      const ctx = {
        signal: abortController.signal,
        agentCancelledEvent: vi.fn().mockReturnValue({
          type: 'cancelled',
          reason: 'User cancelled',
          seq: 999,
          at: Date.now(),
        }),
      } as any;

      await fsm.finalize(ctx);

      expect(fsm.phase).toBe('canceled');
      expect(ctx.agentCancelledEvent).toHaveBeenCalled();
    });
  });

  describe('persist', () => {
    it('should call pendingMessage.persist()', async () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);

      await fsm.persist();

      expect(persister).toHaveBeenCalledWith(message);
    });
  });

  describe('terminal state behavior', () => {
    it('should ignore events when in terminal state', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      fsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });
      expect(fsm.phase).toBe('final');

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 3,
        at: Date.now(),
      });

      expect(message.content).toBe('');
    });
  });

  describe('transition validation', () => {
    it('should not allow invalid transition from initialized to final', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage, { onPhaseChange });

      fsm.handleEvent({ type: 'final', seq: 1, at: Date.now() });

      // initialized → final is not a valid transition
      expect(fsm.phase).toBe('initialized');
    });

    it('should not allow invalid transition from canceling to streaming', () => {
      const fsm = new MessageFSM('msg-1', pendingMessage);
      fsm.cancel();

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceling');
    });
  });
});
