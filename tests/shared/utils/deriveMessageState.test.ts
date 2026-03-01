import { describe, it, expect } from 'vitest';
import { deriveMessageState } from '@/shared/utils/deriveMessageState';
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
    it('should extract thoughts from events', () => {
      const msg = createMessage({
        meta: {
          events: [
            { type: 'thought', content: 'Thinking...', seq: 1, at: 1000 },
            { type: 'thought', content: 'Still thinking...', seq: 2, at: 2000 },
          ],
        },
      });
      const state = deriveMessageState(msg);

      expect(state.thoughts).toHaveLength(2);
      expect(state.thoughts[0]).toEqual({
        content: 'Thinking...',
        seq: 1,
        at: 1000,
      });
      expect(state.thoughts[1]).toEqual({
        content: 'Still thinking...',
        seq: 2,
        at: 2000,
      });
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
});
