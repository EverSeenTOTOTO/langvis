import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFSM } from '@/server/core/MessageFSM';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

const MSG_ID = 'msg-1';

describe('MessageFSM (server)', () => {
  let message: Message;
  let pendingMessage: PendingMessage;
  let onTransition: ReturnType<typeof vi.fn>;

  const createMessage = (id = MSG_ID): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    events: [],
    status: 'initialized',
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    message = createMessage();
    pendingMessage = new PendingMessage(message);
    onTransition = vi.fn();
  });

  const createFSM = (): MessageFSM => {
    const fsm = new MessageFSM(MSG_ID, pendingMessage);
    fsm.addEventListener('transition', e => {
      const { from, to } = (e as CustomEvent).detail;
      onTransition(MSG_ID, from, to);
    });
    return fsm;
  };

  describe('initial state', () => {
    it('should start with initialized phase', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      expect(fsm.phase).toBe('initialized');
      expect(fsm.messageId).toBe(MSG_ID);
    });

    it('should not be terminated initially', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      expect(fsm.isTerminated).toBe(false);
    });

    it('should return message from pendingMessage', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      expect(fsm.message).toBe(message);
    });
  });

  describe('handleEvent - state transitions', () => {
    it('should transition from initialized to streaming on start event', () => {
      const fsm = createFSM();

      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
      expect(onTransition).toHaveBeenCalledWith(
        MSG_ID,
        'initialized',
        'streaming',
      );
    });

    it('should transition from initialized to streaming on stream event', () => {
      const fsm = createFSM();

      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from initialized to streaming on thought event', () => {
      const fsm = createFSM();

      fsm.handleEvent({
        type: 'thought',
        messageId: MSG_ID,
        content: 'Thinking...',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from initialized to streaming on tool_call event', () => {
      const fsm = createFSM();

      fsm.handleEvent({
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should stay in streaming on subsequent events', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: {},
        seq: 3,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');
    });

    it('should transition to final on final event', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to canceled on cancelled event', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'cancelled',
        messageId: MSG_ID,
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to error on error event', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'error',
        messageId: MSG_ID,
        error: 'Something went wrong',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('handleEvent - awaiting_input', () => {
    it('should transition to awaiting_input on tool_progress with awaiting_input status', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: { type: 'string' } },
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('awaiting_input');
    });

    it('should transition from awaiting_input to streaming on tool_result', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: {} },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm.handleEvent({
        type: 'tool_result',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        output: 'user response',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from awaiting_input to streaming on tool_error', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: {} },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm.handleEvent({
        type: 'tool_error',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        error: 'timeout',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from awaiting_input to canceled on cancelled event', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: {} },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm.handleEvent({
        type: 'cancelled',
        messageId: MSG_ID,
        reason: 'User cancelled',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition from awaiting_input to error on error event', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: {} },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm.handleEvent({
        type: 'error',
        messageId: MSG_ID,
        error: 'Something went wrong',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('handleEvent - content delegation', () => {
    it('should delegate stream content to PendingMessage', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: ' World',
        seq: 2,
        at: Date.now(),
      });

      expect(message.content).toBe('Hello World');
    });

    it('should delegate events to PendingMessage', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 2,
        at: Date.now(),
      });

      expect(message.events).toHaveLength(2);
    });
  });

  describe('cancel', () => {
    it('should transition to canceling from initialized', () => {
      const fsm = createFSM();

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from streaming', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from awaiting_input', () => {
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
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
      const fsm = createFSM();
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('final');

      fsm.cancel();

      // Already terminal, should stay final
      expect(fsm.phase).toBe('final');
    });

    it('should not cancel from canceling state', () => {
      const fsm = createFSM();
      fsm.cancel();

      fsm.cancel(); // Second cancel

      expect(onTransition).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminal state behavior', () => {
    it('should ignore events when in terminal state', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('final');

      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 3,
        at: Date.now(),
      });

      expect(message.content).toBe('');
    });
  });

  describe('transition validation', () => {
    it('should not allow invalid transition from initialized to final', () => {
      const fsm = createFSM();

      fsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      // initialized → final is not a valid transition
      expect(fsm.phase).toBe('initialized');
    });

    it('should not allow invalid transition from canceling to streaming', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.cancel();

      fsm.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceling');
    });
  });

  describe('submitting state', () => {
    it('should not allow transition from initialized to submitting', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);

      expect(fsm['sm'].canTransitionTo('submitting')).toBe(false);
    });

    it('should allow transition from awaiting_input to submitting', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm['sm'].transition('submitting');

      expect(fsm.phase).toBe('submitting');
    });

    it('should allow transition from submitting to streaming', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });
      fsm['sm'].transition('submitting');

      fsm['sm'].transition('streaming');

      expect(fsm.phase).toBe('streaming');
    });

    it('should allow transition from submitting to error', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });
      fsm['sm'].transition('submitting');

      fsm['sm'].transition('error');

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should allow transition from submitting to canceled on cancelled event', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });
      fsm['sm'].transition('submitting');

      fsm.handleEvent({
        type: 'cancelled',
        messageId: MSG_ID,
        reason: 'User cancelled',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to streaming when receiving event in submitting state', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input' },
        seq: 2,
        at: Date.now(),
      });
      fsm['sm'].transition('submitting');

      // Simulate receiving a tool_result event (input received)
      fsm.handleEvent({
        type: 'tool_result',
        messageId: MSG_ID,
        callId: 'tc-1',
        toolName: 'human_input',
        output: 'user response',
        seq: 3,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });
  });

  describe('ExecutionContext abort', () => {
    it('should abort ExecutionContext when cancel is called', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.ctx.signal.aborted).toBe(false);

      fsm.cancel();

      expect(fsm.ctx.signal.aborted).toBe(true);
    });

    it('should not abort ExecutionContext when already terminated', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });
      fsm.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 2,
        at: Date.now(),
      });

      const abortedBefore = fsm.ctx.signal.aborted;

      fsm.cancel();

      expect(fsm.ctx.signal.aborted).toBe(abortedBefore);
    });

    it('should abort ExecutionContext with reason', () => {
      const fsm = new MessageFSM(MSG_ID, pendingMessage);
      fsm.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      fsm.cancel();

      expect(fsm.ctx.signal.reason).toBeDefined();
    });
  });
});
