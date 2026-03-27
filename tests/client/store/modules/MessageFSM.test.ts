import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFSM } from '@/client/store/modules/MessageFSM';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

describe('MessageFSM', () => {
  let message: Message;
  let onPhaseChange: ReturnType<typeof vi.fn>;

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events: [] },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    message = createMessage();
    onPhaseChange = vi.fn();
  });

  describe('initial state', () => {
    it('should start with placeholder phase', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.phase).toBe('placeholder');
      expect(fsm.messageId).toBe('msg-1');
    });

    it('should not be terminal initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isTerminal).toBe(false);
      expect(fsm.isInProgress).toBe(true);
    });

    it('should not be able to cancel initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.canCancel).toBe(false);
    });

    it('should not be able to submit input initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.canSubmitInput).toBe(false);
    });
  });

  describe('transition validation', () => {
    it('should only allow placeholder→loading or placeholder→error from placeholder', () => {
      const fsm = new MessageFSM('msg-1', message);

      // Direct transition to streaming is not allowed
      (fsm as any).transition('streaming');
      expect(fsm.phase).toBe('placeholder');

      // Transition to loading is allowed
      (fsm as any).transition('loading');
      expect(fsm.phase).toBe('loading');
    });

    it('should allow loading→streaming transition', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'loading';

      (fsm as any).transition('streaming');

      expect(fsm.phase).toBe('streaming');
    });
  });

  describe('handleEvent - state transitions', () => {
    it('should NOT transition from placeholder to streaming on start event (invalid transition)', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });

      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      // placeholder→streaming is not valid, stays at placeholder
      expect(fsm.phase).toBe('placeholder');
    });

    it('should transition from loading to streaming on start event', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'loading';

      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      expect(fsm.phase).toBe('streaming');
      expect(onPhaseChange).toHaveBeenCalledWith('msg-1', 'streaming');
    });

    it('should NOT transition from placeholder to streaming on stream event', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('placeholder');
    });

    it('should transition from loading to streaming on stream event', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'loading';

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition to final on final event (from streaming)', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'loading';
      fsm.handleEvent({ type: 'start', seq: 1, at: Date.now() });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({ type: 'final', seq: 2, at: Date.now() });

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminal).toBe(true);
    });

    it('should transition to canceled on cancelled event (from streaming)', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'loading';
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
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'loading';
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

  describe('awaiting_input state', () => {
    it('should transition to awaiting_input on tool_progress with awaiting_input status', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'streaming';

      fsm.handleEvent({
        type: 'tool_progress',
        callId: 'tc-1',
        toolName: 'human_input',
        data: {
          status: 'awaiting_input',
          schema: { type: 'string', title: 'Name' },
        },
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('awaiting_input');
      expect(fsm.awaitingInputSchema).toEqual({
        type: 'string',
        title: 'Name',
      });
      expect(fsm.canSubmitInput).toBe(true);
    });

    it('should clear awaitingInputSchema when leaving awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'streaming';
      fsm.handleEvent({
        type: 'tool_progress',
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: {} },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('awaiting_input');

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
      expect(fsm.awaitingInputSchema).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should not cancel from placeholder (canCancel is false)', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });

      fsm.cancel();

      expect(fsm.phase).toBe('placeholder');
    });

    it('should transition to canceling from loading', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'loading';

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from streaming', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'streaming';

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'awaiting_input';

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should not cancel from terminal state', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'final';

      fsm.cancel();

      expect(fsm.phase).toBe('final');
      expect(onPhaseChange).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should NOT transition from placeholder to canceled (invalid transition)', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });

      fsm.close();

      expect(fsm.phase).toBe('placeholder');
    });

    it('should NOT transition from loading to canceled (invalid transition)', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'loading';

      fsm.close();

      expect(fsm.phase).toBe('loading');
    });

    it('should transition to canceled from streaming', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'streaming';

      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to canceled from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'awaiting_input';

      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should not transition from terminal state', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });
      fsm.phase = 'final';

      fsm.close();

      expect(fsm.phase).toBe('final');
    });
  });

  describe('replaceMessageId', () => {
    it('should replace the message ID', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.replaceMessageId('msg-2');

      expect(fsm.messageId).toBe('msg-2');
    });
  });

  describe('computed properties', () => {
    it('isTerminal should be true for final, canceled, error', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.phase = 'streaming';
      expect(fsm.isTerminal).toBe(false);
      expect(fsm.isInProgress).toBe(true);

      fsm.phase = 'final';
      expect(fsm.isTerminal).toBe(true);
      expect(fsm.isInProgress).toBe(false);

      fsm.phase = 'canceled';
      expect(fsm.isTerminal).toBe(true);

      fsm.phase = 'error';
      expect(fsm.isTerminal).toBe(true);
    });

    it('canCancel should be true for loading, streaming, awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.phase = 'placeholder';
      expect(fsm.canCancel).toBe(false);

      fsm.phase = 'loading';
      expect(fsm.canCancel).toBe(true);

      fsm.phase = 'streaming';
      expect(fsm.canCancel).toBe(true);

      fsm.phase = 'awaiting_input';
      expect(fsm.canCancel).toBe(true);

      fsm.phase = 'submitting';
      expect(fsm.canCancel).toBe(false);

      fsm.phase = 'canceling';
      expect(fsm.canCancel).toBe(false);

      fsm.phase = 'final';
      expect(fsm.canCancel).toBe(false);
    });

    it('isSubmitting should be true only in submitting phase', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isSubmitting).toBe(false);

      fsm.phase = 'submitting';
      expect(fsm.isSubmitting).toBe(true);

      fsm.phase = 'streaming';
      expect(fsm.isSubmitting).toBe(false);
    });
  });

  describe('terminal state behavior', () => {
    it('should ignore events when in terminal state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm.phase = 'final';

      fsm.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });

      // Phase should stay final (event ignored)
      expect(fsm.phase).toBe('final');
    });
  });

  describe('placeholder→error transition', () => {
    it('should allow transition from placeholder to error', () => {
      const fsm = new MessageFSM('msg-1', message, { onPhaseChange });

      (fsm as any).transition('error');

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminal).toBe(true);
    });
  });
});
