import { describe, it, expect } from 'vitest';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent } from '@/shared/types';

const MSG_ID = 'msg-123';

describe('PendingMessage', () => {
  const createMessage = () => ({
    id: MSG_ID,
    role: Role.ASSIST,
    content: '',
    events: [] as AgentEvent[],
    status: 'initialized' as const,
    createdAt: new Date(),
    conversationId: 'conv-123',
  });

  describe('handleEvent', () => {
    it('should accumulate stream content', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      pending.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });
      pending.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: ' World',
        seq: 2,
        at: Date.now(),
      });

      expect(msg.content).toBe('Hello World');
      expect(pending.contentLength).toBe(11);
    });

    it('should persist non-stream events to message.events', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      const toolCallEvent: AgentEvent = {
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc_123',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 1,
        at: Date.now(),
      };

      pending.handleEvent(toolCallEvent);

      expect(msg.events).toHaveLength(1);
      expect(msg.events![0]).toEqual(toolCallEvent);
    });

    it('should not persist LLM_CALL tool events', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      pending.handleEvent({
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc_123',
        toolName: ToolIds.LLM_CALL,
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      });

      expect(msg.events).toHaveLength(0);
    });

    it('should set content on error event', () => {
      const msg = createMessage();
      msg.content = 'some previous content';
      const pending = new PendingMessage(msg);

      pending.handleEvent({
        type: 'error',
        messageId: MSG_ID,
        error: 'Something went wrong',
        seq: 1,
        at: Date.now(),
      });

      expect(msg.content).toBe('Something went wrong');
      expect(msg.events).toHaveLength(1);
    });

    it('should initialize events array if not present', () => {
      const msg = createMessage();
      (msg as any).events = undefined;
      const pending = new PendingMessage(msg);

      pending.handleEvent({
        type: 'tool_result',
        messageId: MSG_ID,
        callId: 'tc_123',
        toolName: 'search',
        output: { results: [] },
        seq: 1,
        at: Date.now(),
      });

      expect(msg.events).toBeDefined();
      expect(msg.events).toHaveLength(1);
    });

    it('should handle multiple event types in sequence', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      // Start event
      pending.handleEvent({
        type: 'start',
        messageId: MSG_ID,
        seq: 1,
        at: Date.now(),
      });

      // Stream content
      pending.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });

      // Tool call (non-LLM)
      pending.handleEvent({
        type: 'tool_call',
        messageId: MSG_ID,
        callId: 'tc_123',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 3,
        at: Date.now(),
      });

      // Tool result
      pending.handleEvent({
        type: 'tool_result',
        messageId: MSG_ID,
        callId: 'tc_123',
        toolName: 'search',
        output: { results: ['a', 'b'] },
        seq: 4,
        at: Date.now(),
      });

      // More stream
      pending.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: '!',
        seq: 5,
        at: Date.now(),
      });

      // Final
      pending.handleEvent({
        type: 'final',
        messageId: MSG_ID,
        seq: 6,
        at: Date.now(),
      });

      expect(msg.content).toBe('Hello!');
      expect(msg.events).toHaveLength(4); // start, tool_call, tool_result, final
    });
  });

  describe('contentLength', () => {
    it('should return 0 for empty content', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      expect(pending.contentLength).toBe(0);
    });

    it('should return correct length after accumulation', () => {
      const msg = createMessage();
      msg.content = 'Initial';
      const pending = new PendingMessage(msg);

      pending.handleEvent({
        type: 'stream',
        messageId: MSG_ID,
        content: ' content',
        seq: 1,
        at: Date.now(),
      });

      expect(pending.contentLength).toBe(15);
    });
  });

  describe('toMessage', () => {
    it('should return the underlying message', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg);

      expect(pending.toMessage()).toBe(msg);
    });
  });
});
