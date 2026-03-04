import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from '@/server/core/ExecutionContext';
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

  describe('callId stack', () => {
    it('should generate unique callId for agentToolCallEvent', () => {
      const event1 = ctx.agentToolCallEvent('tool1', {});
      ctx.agentToolResultEvent('tool1', 'done');
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

    it('should pop callId after agentToolResultEvent', () => {
      ctx.agentToolCallEvent('test_tool', {});
      ctx.agentToolResultEvent('test_tool', 'done');

      expect(ctx.currentCallId).toBeUndefined();
    });

    it('should pop callId after agentToolErrorEvent', () => {
      ctx.agentToolCallEvent('test_tool', {});
      ctx.agentToolErrorEvent('test_tool', 'failed');

      expect(ctx.currentCallId).toBeUndefined();
    });

    it('should isolate callIds between consecutive tool calls', () => {
      const call1 = ctx.agentToolCallEvent('tool_a', {});
      const progress1 = ctx.agentToolProgressEvent('tool_a', 'data');
      ctx.agentToolResultEvent('tool_a', 'done');

      const call2 = ctx.agentToolCallEvent('tool_b', {});
      const progress2 = ctx.agentToolProgressEvent('tool_b', 'data');
      ctx.agentToolResultEvent('tool_b', 'done');

      expect((progress1 as any).callId).toBe((call1 as any).callId);
      expect((progress2 as any).callId).toBe((call2 as any).callId);
      expect((progress1 as any).callId).not.toBe((progress2 as any).callId);
    });

    it('should support nested tool calls with stack', () => {
      const outerCall = ctx.agentToolCallEvent('outer_tool', {});
      const outerCallId = (outerCall as any).callId;

      const innerCall = ctx.agentToolCallEvent('inner_tool', {});
      const innerCallId = (innerCall as any).callId;

      expect(innerCallId).not.toBe(outerCallId);
      expect(ctx.currentCallId).toBe(innerCallId);

      ctx.agentToolResultEvent('inner_tool', 'inner_done');
      expect(ctx.currentCallId).toBe(outerCallId);

      ctx.agentToolResultEvent('outer_tool', 'outer_done');
      expect(ctx.currentCallId).toBeUndefined();
    });

    it('should simulate ReAct interleaved tool calls with correct callId isolation', () => {
      // Iteration 1: LLM call via tool_call -> progress -> result
      const llmCall = ctx.agentToolCallEvent('llm_call', {});
      const llmCallId = (llmCall as any).callId;
      const llmProgress1 = ctx.agentToolProgressEvent('llm_call', 'chunk1');
      expect((llmProgress1 as any).callId).toBe(llmCallId);
      ctx.agentToolResultEvent('llm_call', 'response');
      // Stack: [] after result

      // Agent emits tool_call for date_time
      const dtCall = ctx.agentToolCallEvent('date_time', {});
      const dtCallId = (dtCall as any).callId;
      expect(dtCallId).not.toBe(llmCallId);
      // Stack: [dtCallId]

      // date_time tool result via agentToolResultEvent
      ctx.agentToolResultEvent('date_time', '2025-01-01');
      // Stack: [] after result
      expect(ctx.currentCallId).toBeUndefined();

      // Iteration 2: next LLM call gets new callId
      const llmCall2 = ctx.agentToolCallEvent('llm_call', {});
      const llmCallId2 = (llmCall2 as any).callId;
      expect(llmCallId2).not.toBe(llmCallId);
    });
  });

  describe('AgentEvent helpers', () => {
    it('should use currentCallId for agentToolProgressEvent', () => {
      const toolCallEvent = ctx.agentToolCallEvent('test_tool', {});
      const progressEvent = ctx.agentToolProgressEvent('test_tool', 'data');

      expect((progressEvent as any).callId).toBe((toolCallEvent as any).callId);
      expect(progressEvent.type).toBe('tool_progress');
      expect(progressEvent.seq).toBe(2);
    });

    it('should return undefined callId when agentToolProgressEvent is called without tool_call', () => {
      // agentToolProgressEvent uses currentCallId which returns undefined when stack is empty
      const progressEvent = ctx.agentToolProgressEvent('test_tool', 'data');
      expect((progressEvent as any).callId).toBeUndefined();
    });
  });

  describe('tool result/error flow', () => {
    it('should persist tool_result event and pop callId', () => {
      ctx.agentToolCallEvent('test_tool', {});
      const resultEvent = ctx.agentToolResultEvent('test_tool', {
        result: 'success',
      });

      expect(resultEvent.type).toBe('tool_result');
      expect(mockMessage.meta.events).toContainEqual(resultEvent);
      expect(ctx.currentCallId).toBeUndefined();
    });

    it('should persist tool_error event and pop callId', () => {
      ctx.agentToolCallEvent('test_tool', {});
      const errorEvent = ctx.agentToolErrorEvent(
        'test_tool',
        'Something went wrong',
      );

      expect(errorEvent.type).toBe('tool_error');
      expect(mockMessage.meta.events).toContainEqual(errorEvent);
      expect(ctx.currentCallId).toBeUndefined();
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
