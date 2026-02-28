import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from '@/server/core/context';
import { Role } from '@/shared/entities/Message';

describe('ExecutionContext', () => {
  let ctx: ExecutionContext;
  let mockMessage: any;
  let mockController: any;

  beforeEach(() => {
    mockMessage = {
      id: 'msg-123',
      conversationId: 'conv-123',
      role: Role.ASSIST,
      content: '',
      meta: { events: [] },
      createdAt: new Date(),
    };

    mockController = {
      abort: vi.fn(),
      signal: { aborted: false, reason: null },
    };

    ctx = new ExecutionContext(mockMessage, mockController);
  });

  describe('seq counter', () => {
    it('should increment seq for each event', () => {
      const event1 = ctx.agentStartEvent();
      const event2 = ctx.agentThoughtEvent('thinking');
      const event3 = ctx.agentStreamEvent('Hello');

      expect(event1.seq).toBe(1);
      expect(event2.seq).toBe(2);
      expect(event3.seq).toBe(3);
    });

    it('should have monotonically increasing seq', () => {
      const events = [
        ctx.agentStartEvent(),
        ctx.agentToolCallEvent('test_tool', { arg: 'value' }),
        ctx.agentStreamEvent('content'),
        ctx.agentFinalEvent(),
      ];

      for (let i = 0; i < events.length; i++) {
        expect(events[i].seq).toBe(i + 1);
      }
    });
  });

  describe('callId', () => {
    it('should generate unique callId for agentToolCallEvent', () => {
      const event1 = ctx.agentToolCallEvent('tool1', {});
      const event2 = ctx.agentToolCallEvent('tool2', {});

      expect((event1 as any).callId).toBeDefined();
      expect((event2 as any).callId).toBeDefined();
      expect((event1 as any).callId).not.toBe((event2 as any).callId);
    });

    it('should have callId format starting with tc_', () => {
      const event = ctx.agentToolCallEvent('test_tool', {});
      expect((event as any).callId).toMatch(/^tc_/);
    });

    it('should store currentCallId after agentToolCallEvent', () => {
      ctx.agentToolCallEvent('test_tool', { arg: 'value' });

      expect(ctx.currentCallId).toBeDefined();
      expect(ctx.currentCallId).toMatch(/^tc_/);
    });
  });

  describe('ToolEvent helpers', () => {
    it('should auto-generate callId if not set', () => {
      const event = ctx.toolProgressEvent('test_tool', 'progress');

      expect(event.callId).toBeDefined();
      expect(event.seq).toBe(1);
    });

    it('should use stored currentCallId when available', () => {
      const toolCallEvent = ctx.agentToolCallEvent('test_tool', {});
      const progressEvent = ctx.toolProgressEvent('test_tool', 'data');

      expect(progressEvent.callId).toBe((toolCallEvent as any).callId);
    });
  });

  describe('adaptToolEvent', () => {
    it('should adapt progress event with callId and seq', () => {
      const toolEvent = {
        type: 'progress' as const,
        callId: 'tc_custom',
        toolName: 'test_tool',
        data: 'progress data',
        seq: 100,
        at: Date.now(),
      };

      const agentEvent = ctx.adaptToolEvent(toolEvent);

      expect(agentEvent.type).toBe('tool_progress');
      expect((agentEvent as any).callId).toBe('tc_custom');
      expect(agentEvent.seq).toBe(1);
    });

    it('should adapt result event and persist it', () => {
      const toolEvent = {
        type: 'result' as const,
        callId: 'tc_abc',
        toolName: 'test_tool',
        output: { result: 'success' },
        seq: 50,
        at: Date.now(),
      };

      const agentEvent = ctx.adaptToolEvent(toolEvent);

      expect(agentEvent.type).toBe('tool_result');
      expect((agentEvent as any).callId).toBe('tc_abc');
      expect(mockMessage.meta.events).toContainEqual(agentEvent);
    });

    it('should adapt error event and persist it', () => {
      const toolEvent = {
        type: 'error' as const,
        callId: 'tc_err',
        toolName: 'test_tool',
        error: 'Something went wrong',
        seq: 75,
        at: Date.now(),
      };

      const agentEvent = ctx.adaptToolEvent(toolEvent);

      expect(agentEvent.type).toBe('tool_error');
      expect((agentEvent as any).callId).toBe('tc_err');
      expect(mockMessage.meta.events).toContainEqual(agentEvent);
    });
  });

  describe('event persistence', () => {
    it('should persist start event', () => {
      ctx.agentStartEvent();

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('start');
    });

    it('should persist thought event', () => {
      ctx.agentThoughtEvent('thinking...');

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('thought');
    });

    it('should persist tool_call event', () => {
      ctx.agentToolCallEvent('test_tool', { arg: 'value' });

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('tool_call');
    });

    it('should NOT persist stream event', () => {
      ctx.agentStreamEvent('content');

      expect(mockMessage.meta.events).toHaveLength(0);
    });

    it('should persist final event', () => {
      ctx.agentFinalEvent();

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('final');
    });

    it('should persist cancelled event', () => {
      ctx.agentCancelledEvent('User cancelled');

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('cancelled');
    });

    it('should persist error event', () => {
      ctx.agentErrorEvent('Something went wrong');

      expect(mockMessage.meta.events).toHaveLength(1);
      expect(mockMessage.meta.events[0].type).toBe('error');
      expect(mockMessage.content).toBe('Something went wrong');
    });
  });

  describe('cancelled event', () => {
    it('should create cancelled event with reason', () => {
      const event = ctx.agentCancelledEvent('User requested');

      expect(event.type).toBe('cancelled');
      expect((event as any).reason).toBe('User requested');
      expect(event.seq).toBe(1);
      expect(event.at).toBeDefined();
    });
  });

  describe('content management', () => {
    it('should append content', () => {
      ctx.appendContent('Hello');
      ctx.appendContent(' World');

      expect(mockMessage.content).toBe('Hello World');
    });

    it('should set content', () => {
      ctx.setContent('New content');

      expect(mockMessage.content).toBe('New content');
    });

    it('should append content on agentStreamEvent', () => {
      ctx.agentStreamEvent('Hello');
      ctx.agentStreamEvent(' World');

      expect(mockMessage.content).toBe('Hello World');
    });
  });

  describe('abort', () => {
    it('should call controller abort with reason', () => {
      ctx.abort('Test abort');

      expect(mockController.abort).toHaveBeenCalled();
    });
  });

  describe('signal and traceId', () => {
    it('should expose signal from controller', () => {
      expect(ctx.signal).toBe(mockController.signal);
    });

    it('should expose traceId from message id', () => {
      expect(ctx.traceId).toBe('msg-123');
    });
  });
});
