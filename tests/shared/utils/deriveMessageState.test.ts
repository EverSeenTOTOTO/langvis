import { describe, it, expect } from 'vitest';
import { deriveMessageState } from '@/client/pages/Home/components/AgentMessage/deriveMessageState';
import { Role } from '@/shared/types/entities';

describe('deriveMessageState', () => {
  const createMessage = (overrides: Record<string, unknown> = {}) => ({
    id: 'msg-1',
    conversationId: 'conv-1',
    role: Role.ASSIST,
    content: '',
    meta: { events: [] },
    createdAt: new Date(),
    ...overrides,
  });

  describe('hasContent', () => {
    it('should return false for empty content', () => {
      const msg = createMessage({ content: '' });
      const state = deriveMessageState(msg);

      expect(state.hasContent).toBe(false);
    });

    it('should return true for non-empty content', () => {
      const msg = createMessage({ content: 'Hello' });
      const state = deriveMessageState(msg);

      expect(state.hasContent).toBe(true);
    });
  });

  describe('isTerminal', () => {
    it('should return false when no terminal event', () => {
      const msg = createMessage({
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            { type: 'stream', content: 'Hello', seq: 2, at: Date.now() },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isTerminated).toBe(false);
    });

    it('should return true for final event', () => {
      const msg = createMessage({
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            { type: 'final', seq: 2, at: Date.now() },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isTerminated).toBe(true);
    });

    it('should return true for error event', () => {
      const msg = createMessage({
        meta: {
          events: [
            { type: 'error', error: 'Test error', seq: 1, at: Date.now() },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isTerminated).toBe(true);
    });

    it('should return true for cancelled event', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'cancelled',
              reason: 'User cancelled',
              seq: 1,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isTerminated).toBe(true);
    });
  });

  describe('toolCallTimeline', () => {
    it('should return empty array when no tool calls', () => {
      const msg = createMessage();
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline).toEqual([]);
    });

    it('should build tool call timeline from events', () => {
      const at = Date.now();
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: { arg: 'value' },
              seq: 1,
              at,
            },
            {
              type: 'tool_result',
              callId: 'tc_1',
              toolName: 'test_tool',
              output: { result: 'success' },
              seq: 2,
              at: at + 100,
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline).toHaveLength(1);
      expect(state.toolCallTimeline[0]).toEqual({
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: { arg: 'value' },
        seq: 1,
        at,
        status: 'done',
        output: { result: 'success' },
        progress: [],
        thought: undefined,
      });
    });

    it('should track pending tool calls', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 1,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline).toHaveLength(1);
      expect(state.toolCallTimeline[0].status).toBe('pending');
    });

    it('should track tool errors', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 1,
              at: Date.now(),
            },
            {
              type: 'tool_error',
              callId: 'tc_1',
              toolName: 'test_tool',
              error: 'Something went wrong',
              seq: 2,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline[0].status).toBe('error');
      expect(state.toolCallTimeline[0].error).toBe('Something went wrong');
    });

    it('should collect progress events with seq and at', () => {
      const at1 = Date.now();
      const at2 = at1 + 100;
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 1,
              at: at1,
            },
            {
              type: 'tool_progress',
              callId: 'tc_1',
              toolName: 'test_tool',
              data: 'progress 1',
              seq: 2,
              at: at1,
            },
            {
              type: 'tool_progress',
              callId: 'tc_1',
              toolName: 'test_tool',
              data: 'progress 2',
              seq: 3,
              at: at2,
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline[0].progress).toEqual([
        { data: 'progress 1', seq: 2, at: at1 },
        { data: 'progress 2', seq: 3, at: at2 },
      ]);
    });

    it('should handle multiple tool calls and preserve order by seq', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_2',
              toolName: 'tool_2',
              toolArgs: {},
              seq: 2,
              at: Date.now(),
            },
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'tool_1',
              toolArgs: {},
              seq: 1,
              at: Date.now(),
            },
            {
              type: 'tool_result',
              callId: 'tc_1',
              toolName: 'tool_1',
              output: 'done',
              seq: 3,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.toolCallTimeline).toHaveLength(2);
      // Should be sorted by seq
      expect(state.toolCallTimeline[0].callId).toBe('tc_1');
      expect(state.toolCallTimeline[0].status).toBe('done');
      expect(state.toolCallTimeline[1].callId).toBe('tc_2');
      expect(state.toolCallTimeline[1].status).toBe('pending');
    });
  });

  describe('hasPendingTools', () => {
    it('should return false when no tool calls', () => {
      const msg = createMessage();
      const state = deriveMessageState(msg);

      expect(state.hasPendingTools).toBe(false);
    });

    it('should return true when tool is pending', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 1,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.hasPendingTools).toBe(true);
    });

    it('should return false when all tools completed', () => {
      const msg = createMessage({
        meta: {
          events: [
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 1,
              at: Date.now(),
            },
            {
              type: 'tool_result',
              callId: 'tc_1',
              toolName: 'test_tool',
              output: 'done',
              seq: 2,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.hasPendingTools).toBe(false);
    });
  });

  describe('thoughts', () => {
    it('should associate thought with following tool_call', () => {
      const at = Date.now();
      const msg = createMessage({
        meta: {
          events: [
            { type: 'thought', content: 'Thinking...', seq: 1, at },
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 2,
              at: at + 100,
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      // Thought should be associated with the tool call, not in standalone thoughts
      expect(state.thoughts).toHaveLength(0);
      expect(state.toolCallTimeline[0].thought).toBe('Thinking...');
    });

    it('should keep thought as standalone when followed by final event', () => {
      const at = Date.now();
      const msg = createMessage({
        meta: {
          events: [
            { type: 'thought', content: 'Final thought...', seq: 1, at },
            { type: 'final', seq: 2, at: at + 100 },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.thoughts).toHaveLength(1);
      expect(state.thoughts[0].content).toBe('Final thought...');
    });

    it('should keep thought as standalone when followed by stream event', () => {
      const at = Date.now();
      const msg = createMessage({
        meta: {
          events: [
            { type: 'thought', content: 'Final thought...', seq: 1, at },
            { type: 'stream', content: 'Answer', seq: 2, at: at + 100 },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.thoughts).toHaveLength(1);
      expect(state.thoughts[0].content).toBe('Final thought...');
    });

    it('should keep thought as standalone when no following event', () => {
      const at = Date.now();
      const msg = createMessage({
        meta: {
          events: [
            { type: 'thought', content: 'Orphan thought...', seq: 1, at },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.thoughts).toHaveLength(1);
      expect(state.thoughts[0].content).toBe('Orphan thought...');
    });
  });

  describe('hasEvents', () => {
    it('should return false when no events', () => {
      const msg = createMessage();
      const state = deriveMessageState(msg);

      expect(state.hasEvents).toBe(false);
    });

    it('should return true when has events', () => {
      const msg = createMessage({
        meta: {
          events: [{ type: 'start', seq: 1, at: Date.now() }],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.hasEvents).toBe(true);
    });
  });

  describe('isAwaitingContent', () => {
    it('should return true when agent started but no content or tools yet', () => {
      const msg = createMessage({
        content: '',
        meta: {
          events: [{ type: 'start', seq: 1, at: Date.now() }],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isAwaitingContent).toBe(true);
    });

    it('should return false when no events', () => {
      const msg = createMessage({ content: '' });
      const state = deriveMessageState(msg);

      expect(state.isAwaitingContent).toBe(false);
    });

    it('should return false when content exists', () => {
      const msg = createMessage({
        content: 'Hello',
        meta: {
          events: [{ type: 'start', seq: 1, at: Date.now() }],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isAwaitingContent).toBe(false);
    });

    it('should return false when terminated', () => {
      const msg = createMessage({
        content: '',
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            { type: 'final', seq: 2, at: Date.now() },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isAwaitingContent).toBe(false);
    });

    it('should return false when tools are pending', () => {
      const msg = createMessage({
        content: '',
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'test_tool',
              toolArgs: {},
              seq: 2,
              at: Date.now(),
            },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.isAwaitingContent).toBe(false);
    });
  });

  describe('nested human-in-the-loop detection', () => {
    it('should capture awaiting_input progress from nested tool call', () => {
      // Scenario: PositionAdjustTool calls HumanInTheLoopTool internally
      // The tool_call event has toolName='position_adjust_tool', but progress
      // contains the awaiting_input status from the nested HumanInTheLoopTool
      const msg = createMessage({
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'position_adjust_tool',
              toolArgs: { conversationId: 'conv-1' },
              seq: 2,
              at: Date.now(),
            },
            {
              type: 'tool_progress',
              callId: 'tc_1',
              toolName: 'position_adjust_tool',
              data: {
                status: 'awaiting_input',
                message: '请填写以下仓位调整信息：',
                schema: {
                  type: 'object',
                  properties: {
                    totalAssets: { type: 'number' },
                  },
                },
              },
              seq: 3,
              at: Date.now(),
            },
          ],
        },
      });

      const state = deriveMessageState(msg);

      // Tool call should be pending
      expect(state.hasPendingTools).toBe(true);
      expect(state.toolCallTimeline).toHaveLength(1);
      expect(state.toolCallTimeline[0].toolName).toBe('position_adjust_tool');
      expect(state.toolCallTimeline[0].status).toBe('pending');

      // Progress should contain awaiting_input data
      const progress = state.toolCallTimeline[0].progress;
      expect(progress).toHaveLength(1);
      expect((progress[0].data as Record<string, unknown>)?.status).toBe(
        'awaiting_input',
      );
    });

    it('should not confuse awaiting_input with different tool name', () => {
      // Verify that the awaiting_input detection works regardless of the
      // outer tool's name - it checks progress data, not tool name
      const msg = createMessage({
        meta: {
          events: [
            { type: 'start', seq: 1, at: Date.now() },
            {
              type: 'tool_call',
              callId: 'tc_1',
              toolName: 'some_other_tool', // Not human_in_the_loop_tool
              toolArgs: {},
              seq: 2,
              at: Date.now(),
            },
            {
              type: 'tool_progress',
              callId: 'tc_1',
              toolName: 'some_other_tool',
              data: {
                status: 'awaiting_input',
                message: 'Input required',
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
              seq: 3,
              at: Date.now(),
            },
          ],
        },
      });

      const state = deriveMessageState(msg);

      // Progress should still contain awaiting_input status
      const progress = state.toolCallTimeline[0].progress;
      expect((progress[0].data as Record<string, unknown>)?.status).toBe(
        'awaiting_input',
      );
      expect(
        (progress[0].data as Record<string, unknown>)?.schema,
      ).toBeDefined();
    });
  });
});
