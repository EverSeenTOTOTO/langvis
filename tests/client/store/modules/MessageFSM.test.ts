import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFSM } from '@/client/store/modules/MessageFSM';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

describe('MessageFSM', () => {
  let message: Message;

  const createMessage = (id = 'msg-1', events: AgentEvent[] = []): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    message = createMessage();
  });

  describe('fromMessage', () => {
    it('should create FSM and replay events to reach correct phase', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'stream',
          messageId: 'msg-1',
          content: 'Hello',
          seq: 2,
          at: Date.now(),
        },
        { type: 'final', messageId: 'msg-1', seq: 3, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      msg.content = 'Hello';

      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminated).toBe(true);
      // Content is rebuilt from events (stream events append to content)
      expect(fsm.msg.content).toBe('HelloHello'); // 'Hello' from msg.content + 'Hello' from stream event
    });

    it('should handle empty events gracefully', () => {
      const msg = createMessage('msg-1', []);

      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('initialized');
      expect(fsm.isTerminated).toBe(false);
    });

    it('should reach streaming phase with partial events', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'test',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);

      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('streaming');
    });
  });

  describe('initial state', () => {
    it('should start with initialized phase', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.phase).toBe('initialized');
      expect(fsm.msg.id).toBe('msg-1');
    });

    it('should not be terminated initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isTerminated).toBe(false);
    });

    it('should not be able to cancel initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isCancellable).toBe(false);
    });

    it('should not be able to submit input initially', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isAwaitingInput).toBe(false);
    });
  });

  describe('transition validation', () => {
    it('should only allow initialized→streaming or initialized→error from initialized', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm['sm'].canTransitionTo('streaming')).toBe(true);
      expect(fsm['sm'].transition('streaming')).toBe(true);
      expect(fsm.phase).toBe('streaming');
    });

    it('should allow streaming→streaming transition', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');

      expect(fsm['sm'].canTransitionTo('streaming')).toBe(true);
      fsm['sm'].transition('streaming');

      expect(fsm.phase).toBe('streaming');
    });
  });

  describe('handleEvent - state transitions', () => {
    it('should transition from initialized to streaming on start event', () => {
      const onTransition = vi.fn();
      const fsm = new MessageFSM('msg-1', message);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });

      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
      expect(onTransition).toHaveBeenCalledWith('initialized', 'streaming');
    });

    it('should transition from streaming to streaming on start event', () => {
      const onTransition = vi.fn();
      const fsm = new MessageFSM('msg-1', message);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });
      fsm['sm'].transition('initialized');

      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
      expect(onTransition).toHaveBeenCalledWith('initialized', 'streaming');
    });

    it('should transition from initialized to streaming on stream event', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.handleEvent({
        type: 'stream',
        messageId: 'msg-1',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
      expect(fsm.msg.content).toBe('Hello');
    });

    it('should transition from streaming to streaming on stream event', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');

      fsm.handleEvent({
        type: 'stream',
        messageId: 'msg-1',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition to final on final event (from streaming)', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('streaming');

      fsm.handleEvent({
        type: 'final',
        messageId: 'msg-1',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to canceled on cancelled event (from streaming)', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'cancelled',
        messageId: 'msg-1',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to error on error event', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      fsm.handleEvent({
        type: 'error',
        messageId: 'msg-1',
        error: 'Something went wrong',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('awaiting_input state', () => {
    it('should transition to awaiting_input on tool_progress with awaiting_input status', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      fsm.handleEvent({
        type: 'tool_progress',
        messageId: 'msg-1',
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
      expect(fsm.awaitingInput?.schema).toEqual({
        type: 'string',
        title: 'Name',
      });
      expect(fsm.isAwaitingInput).toBe(true);
    });

    it('should clear awaitingInput when leaving awaiting_input via cancel', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      // Manually set awaitingInputData
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: 'msg-1',
        callId: 'tc-1',
        toolName: 'human_input',
        data: {
          status: 'awaiting_input',
          schema: { type: 'string' },
        },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.awaitingInput).not.toBeNull();

      fsm.cancel();
      expect(fsm.phase).toBe('canceling');
      expect(fsm.awaitingInput).toBeNull();
    });

    it('should transition from awaiting_input to streaming on tool_result', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.handleEvent({
        type: 'tool_result',
        messageId: 'msg-1',
        callId: 'tc-1',
        toolName: 'human_input',
        output: 'user input',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
      expect(fsm.awaitingInput).toBeNull();
    });

    it('should transition from awaiting_input to streaming on tool_error', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.handleEvent({
        type: 'tool_error',
        messageId: 'msg-1',
        callId: 'tc-1',
        toolName: 'human_input',
        error: 'timeout',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('streaming');
    });

    it('should transition from awaiting_input to canceled on cancelled event', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.handleEvent({
        type: 'cancelled',
        messageId: 'msg-1',
        reason: 'User cancelled',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition from awaiting_input to error on error event', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.handleEvent({
        type: 'error',
        messageId: 'msg-1',
        error: 'Something went wrong',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('replay: awaiting_input scenarios', () => {
    it('should reach final phase when human_input tool completes', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: { type: 'string' } },
          seq: 3,
          at: Date.now(),
        },
        {
          type: 'tool_result',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          output: 'user response',
          seq: 4,
          at: Date.now(),
        },
        { type: 'final', messageId: 'msg-1', seq: 5, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should reach canceled phase when cancelled after awaiting_input', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: {} },
          seq: 3,
          at: Date.now(),
        },
        {
          type: 'cancelled',
          messageId: 'msg-1',
          reason: 'timeout',
          seq: 4,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('canceled');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should reach error phase when error after awaiting_input', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: {} },
          seq: 3,
          at: Date.now(),
        },
        {
          type: 'error',
          messageId: 'msg-1',
          error: 'API failed',
          seq: 4,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should handle multiple human_input cycles in one session', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: { type: 'string' } },
          seq: 3,
          at: Date.now(),
        },
        {
          type: 'tool_result',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          output: 'answer 1',
          seq: 4,
          at: Date.now(),
        },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-2',
          toolName: 'human_input',
          toolArgs: {},
          seq: 5,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-2',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: { type: 'string' } },
          seq: 6,
          at: Date.now(),
        },
        {
          type: 'tool_result',
          messageId: 'msg-1',
          callId: 'tc-2',
          toolName: 'human_input',
          output: 'answer 2',
          seq: 7,
          at: Date.now(),
        },
        { type: 'final', messageId: 'msg-1', seq: 8, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('final');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should transition to canceling from initialized', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from streaming', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('streaming');

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from streaming', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceling from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.cancel();

      expect(fsm.phase).toBe('canceling');
    });

    it('should not cancel from terminal state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('final');

      fsm.cancel();

      expect(fsm.phase).toBe('final');
    });
  });

  describe('close', () => {
    it('should NOT transition from initialized to canceled (invalid transition)', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.close();

      expect(fsm.phase).toBe('initialized');
    });

    it('should NOT transition from streaming to canceled (invalid transition)', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');

      fsm.close();

      expect(fsm.phase).toBe('initialized');
    });

    it('should transition to canceled from streaming', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to canceled from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should not transition from terminal state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('final');

      fsm.close();

      expect(fsm.phase).toBe('final');
    });
  });

  describe('messageId', () => {
    it('should expose the message ID', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.messageId).toBe('msg-1');
    });
  });

  describe('computed properties', () => {
    it('isTerminated should be true for final, canceled, error', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      expect(fsm.isTerminated).toBe(false);

      fsm['sm'].transition('final');
      expect(fsm.isTerminated).toBe(true);

      const fsm2 = new MessageFSM('msg-2', createMessage('msg-2'));
      fsm2['sm'].transition('initialized');
      fsm2['sm'].transition('streaming');
      fsm2['sm'].transition('canceled');
      expect(fsm2.isTerminated).toBe(true);

      const fsm3 = new MessageFSM('msg-3', createMessage('msg-3'));
      fsm3['sm'].transition('initialized');
      fsm3['sm'].transition('streaming');
      fsm3['sm'].transition('error');
      expect(fsm3.isTerminated).toBe(true);
    });

    it('isCancellable should be true for streaming, awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);

      // initialized is NOT cancellable (no active message yet)
      expect(fsm.isCancellable).toBe(false);

      fsm['sm'].transition('streaming');
      expect(fsm.isCancellable).toBe(true);

      fsm['sm'].transition('awaiting_input');
      expect(fsm.isCancellable).toBe(true);

      fsm['sm'].transition('submitting');
      expect(fsm.isCancellable).toBe(false);

      const fsm2 = new MessageFSM('msg-2', createMessage('msg-2'));
      fsm2['sm'].transition('canceling');
      expect(fsm2.isCancellable).toBe(false);

      const fsm3 = new MessageFSM('msg-3', createMessage('msg-3'));
      fsm3['sm'].transition('streaming');
      fsm3['sm'].transition('final');
      expect(fsm3.isCancellable).toBe(false);
    });

    it('isSubmitting should be true only in submitting phase', () => {
      const fsm = new MessageFSM('msg-1', message);

      expect(fsm.isSubmitting).toBe(false);

      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');
      fsm['sm'].transition('submitting');
      expect(fsm.isSubmitting).toBe(true);

      fsm['sm'].transition('streaming');
      expect(fsm.isSubmitting).toBe(false);
    });
  });

  describe('terminal state behavior', () => {
    it('should ignore events when in terminal state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('final');

      fsm.handleEvent({
        type: 'stream',
        messageId: 'msg-1',
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('final');
    });
  });

  describe('initialized→error transition', () => {
    it('should allow transition from initialized to error', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm['sm'].transition('error');

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });
  });

  describe('computed: toolCallTimeline', () => {
    it('should derive tool call timeline from events', () => {
      const events: AgentEvent[] = [
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          toolArgs: { q: 'test' },
          seq: 1,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          data: { status: 'running' },
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_result',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          output: 'result',
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      const timeline = fsm.toolCallTimeline;

      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({
        callId: 'tc-1',
        toolName: 'search',
        status: 'done',
        output: 'result',
      });
      expect(timeline[0].progress).toHaveLength(1);
    });

    it('should associate thought with tool call', () => {
      const events: AgentEvent[] = [
        {
          type: 'thought',
          messageId: 'msg-1',
          content: 'I need to search',
          seq: 1,
          at: Date.now(),
        },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      const timeline = fsm.toolCallTimeline;

      expect(timeline[0].thought).toBe('I need to search');
    });

    it('should track pending tool calls', () => {
      const events: AgentEvent[] = [
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          toolArgs: {},
          seq: 1,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.hasPendingTools).toBe(true);
      expect(fsm.pendingToolCalls).toHaveLength(1);
    });
  });

  describe('computed: thoughts', () => {
    it('should derive standalone thoughts (not associated with tool)', () => {
      const events: AgentEvent[] = [
        {
          type: 'thought',
          messageId: 'msg-1',
          content: 'Final answer',
          seq: 1,
          at: Date.now(),
        },
        { type: 'final', messageId: 'msg-1', seq: 2, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.thoughts).toHaveLength(1);
      expect(fsm.thoughts[0].content).toBe('Final answer');
    });

    it('should not include thoughts associated with tool calls', () => {
      const events: AgentEvent[] = [
        {
          type: 'thought',
          messageId: 'msg-1',
          content: 'Searching...',
          seq: 1,
          at: Date.now(),
        },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_result',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          output: 'done',
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.thoughts).toHaveLength(0);
    });
  });

  describe('computed: isAwaitingContent', () => {
    it('should be true when has events but no content or tools', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.isThinking).toBe(true);
    });

    it('should be false when has content', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'stream',
          messageId: 'msg-1',
          content: 'Hi',
          seq: 2,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      msg.content = 'Hi';
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.isThinking).toBe(false);
    });

    it('should be false when has pending tools', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'search',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.isThinking).toBe(false);
    });

    it('should be false when terminated', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        { type: 'final', messageId: 'msg-1', seq: 2, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.isThinking).toBe(false);
    });
  });

  describe('message properties', () => {
    it('should expose message content', () => {
      const msg = createMessage('msg-1', []);
      msg.content = 'Hello world';
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.msg.content).toBe('Hello world');
    });

    it('should expose message events', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.msg.meta?.events).toStrictEqual(events);
    });

    it('should expose conversationId', () => {
      const msg = createMessage('msg-1', []);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.msg.conversationId).toBe('conv-1');
    });
  });

  describe('nested awaiting_input', () => {
    it('should bubble up awaiting_input from nested agent_call', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          toolArgs: { agentId: 'nested_agent' },
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          data: {
            status: 'agent_event',
            event: {
              type: 'tool_progress',
              callId: 'tc_inner',
              toolName: 'human_input',
              data: {
                status: 'awaiting_input',
                message: 'Nested input required',
                schema: { type: 'string' },
              },
              seq: 100,
              at: Date.now(),
            },
          },
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('awaiting_input');
      expect(fsm.awaitingInput?.message).toBe('Nested input required');
    });

    it('should bubble up awaiting_input from 3-level nesting', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          toolArgs: { agentId: 'child_agent' },
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          data: {
            status: 'agent_event',
            event: {
              type: 'tool_progress',
              callId: 'tc_middle',
              toolName: 'position_adjust_tool',
              data: {
                status: 'awaiting_input',
                message: '请填写信息',
                schema: { type: 'object' },
              },
              seq: 100,
              at: Date.now(),
            },
          },
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('awaiting_input');
      expect(fsm.awaitingInput?.message).toBe('请填写信息');
    });

    it('should not bubble up other nested events (only awaiting_input)', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          toolArgs: { agentId: 'nested_agent' },
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc_outer',
          toolName: 'agent_call',
          data: {
            status: 'agent_event',
            event: {
              type: 'stream',
              messageId: 'msg-1',
              content: 'Nested stream content',
              seq: 100,
              at: Date.now(),
            },
          },
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('streaming');
      expect(fsm.awaitingInput).toBeNull();
    });

    it('should return null awaitingInput when message is terminated', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: { type: 'string' } },
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'error',
          messageId: 'msg-1',
          error: 'Something failed',
          seq: 3,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);
      const fsm = MessageFSM.fromMessage(msg);

      expect(fsm.phase).toBe('error');
      expect(fsm.awaitingInput).toBeNull();
    });
  });

  describe('transition event', () => {
    it('should dispatch transition event with { from, to } on state change', () => {
      const onTransition = vi.fn();
      const fsm = new MessageFSM('msg-1', message);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });

      fsm.start();

      expect(onTransition).toHaveBeenCalledWith('initialized', 'streaming');
    });

    it('should dispatch transition event during replay from events', () => {
      const onTransition = vi.fn();

      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'tc-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: {} },
          seq: 2,
          at: Date.now(),
        },
      ];
      const msg = createMessage('msg-1', events);

      // Use constructor + manual replay so listener is attached before events fire
      const fsm = new MessageFSM('msg-1', msg);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });

      // Clear events before replay
      if (fsm.msg.meta?.events) {
        fsm.msg.meta.events = [];
      }
      for (const event of events) {
        fsm.handleEvent(event);
      }

      expect(onTransition).toHaveBeenCalledWith('initialized', 'streaming');
      expect(onTransition).toHaveBeenCalledWith('streaming', 'awaiting_input');
    });

    it('should dispatch transition event for each event-driven transition', () => {
      const onTransition = vi.fn();
      const fsm = new MessageFSM('msg-1', message);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });
      fsm['sm'].transition('initialized');

      fsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(onTransition).toHaveBeenCalledWith('initialized', 'streaming');

      fsm.handleEvent({
        type: 'final',
        messageId: 'msg-1',
        seq: 2,
        at: Date.now(),
      });
      expect(onTransition).toHaveBeenCalledWith('streaming', 'final');
    });

    it('should clear awaitingInputData when leaving awaiting_input', () => {
      const onTransition = vi.fn();
      const fsm = new MessageFSM('msg-1', message);
      fsm.addEventListener('transition', e => {
        const { from, to } = (e as CustomEvent).detail;
        onTransition(from, to);
      });
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      // Enter awaiting_input
      fsm.handleEvent({
        type: 'tool_progress',
        messageId: 'msg-1',
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: { type: 'string' } },
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.awaitingInput).not.toBeNull();

      // Leave via cancel → awaitingInputData cleared
      fsm.cancel();
      expect(onTransition).toHaveBeenCalledWith('awaiting_input', 'canceling');
      expect(fsm.awaitingInput).toBeNull();
    });
  });

  describe('submitting state', () => {
    it('should allow transition from awaiting_input to submitting', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      expect(fsm['sm'].canTransitionTo('submitting')).toBe(true);

      fsm['sm'].transition('submitting');

      expect(fsm.phase).toBe('submitting');
      expect(fsm.isSubmitting).toBe(true);
    });

    it('should allow transition from submitting to streaming', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');
      fsm['sm'].transition('submitting');

      fsm['sm'].transition('streaming');

      expect(fsm.phase).toBe('streaming');
      expect(fsm.isSubmitting).toBe(false);
    });

    it('should allow transition from submitting to error', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');
      fsm['sm'].transition('submitting');

      fsm['sm'].transition('error');

      expect(fsm.phase).toBe('error');
      expect(fsm.isTerminated).toBe(true);
    });

    it('should transition to canceled when cancel is called from submitting', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');
      fsm['sm'].transition('submitting');

      // submitting now allows canceling transition
      expect(fsm.isCancellable).toBe(false);

      fsm.cancel();

      // cancel() transitions to canceling (submitting -> canceling is valid)
      expect(fsm.phase).toBe('canceling');
    });

    it('should transition to canceled on cancelled event from submitting', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');
      fsm['sm'].transition('submitting');

      fsm.handleEvent({
        type: 'cancelled',
        messageId: 'msg-1',
        reason: 'User cancelled',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('canceled');
    });
  });

  describe('SSE disconnect handling', () => {
    it('should be able to close from streaming state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      // close() should transition to canceled
      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should be able to close from awaiting_input state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      fsm.close();

      expect(fsm.phase).toBe('canceled');
    });

    it('should clear awaitingInput when closing from awaiting_input', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      fsm.handleEvent({
        type: 'tool_progress',
        messageId: 'msg-1',
        callId: 'tc-1',
        toolName: 'human_input',
        data: { status: 'awaiting_input', schema: { type: 'string' } },
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.awaitingInput).not.toBeNull();

      fsm.close();

      expect(fsm.awaitingInput).toBeNull();
    });

    it('should not close from initialized state', () => {
      const fsm = new MessageFSM('msg-1', message);

      fsm.close();

      expect(fsm.phase).toBe('initialized');
    });

    it('should not close from streaming state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');

      fsm.close();

      expect(fsm.phase).toBe('initialized');
    });
  });

  describe('start method', () => {
    it('should transition from initialized to streaming', () => {
      const fsm = new MessageFSM('msg-1', message);

      const result = fsm.start();

      expect(result).toBe(true);
      expect(fsm.phase).toBe('streaming');
    });

    it('should return false if not in initialized state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('streaming');

      const result = fsm.start();

      expect(result).toBe(true);
      expect(fsm.phase).toBe('streaming');
    });
  });

  describe('submitInput method', () => {
    it('should transition from awaiting_input to submitting', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');
      fsm['sm'].transition('awaiting_input');

      const result = fsm.submitInput();

      expect(result).toBe(true);
      expect(fsm.phase).toBe('submitting');
    });

    it('should return false if not in awaiting_input state', () => {
      const fsm = new MessageFSM('msg-1', message);
      fsm['sm'].transition('initialized');
      fsm['sm'].transition('streaming');

      const result = fsm.submitInput();

      expect(result).toBe(false);
      expect(fsm.phase).toBe('streaming');
    });

    it('should return false from initialized state', () => {
      const fsm = new MessageFSM('msg-1', message);

      const result = fsm.submitInput();

      expect(result).toBe(false);
    });
  });

  describe('setMessage method', () => {
    it('should update the message reference', () => {
      const fsm = new MessageFSM('msg-1', message);

      const newMessage = createMessage('msg-1');
      newMessage.content = 'Updated content';

      fsm.setMessage(newMessage);

      // Verify content is updated (content is a getter that reads from _message)
      expect(fsm.msg.content).toBe('Updated content');
    });

    it('should allow updating events through new message', () => {
      const events: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
      ];
      const fsm = new MessageFSM('msg-1', message);

      const newMessage = createMessage('msg-1');
      newMessage.meta = { events };

      fsm.setMessage(newMessage);

      expect(fsm.msg.meta?.events).toHaveLength(1);
    });
  });
});
