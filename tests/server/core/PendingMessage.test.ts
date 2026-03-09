import { describe, it, expect, vi } from 'vitest';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent } from '@/shared/types';

describe('PendingMessage', () => {
  const createMessage = () => ({
    id: 'msg-123',
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as AgentEvent[] },
    createdAt: new Date(),
    conversationId: 'conv-123',
  });

  const createPersister = () => vi.fn().mockResolvedValue(undefined);

  describe('handleEvent', () => {
    it('should accumulate stream content', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      pending.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });
      pending.handleEvent({
        type: 'stream',
        content: ' World',
        seq: 2,
        at: Date.now(),
      });

      expect(msg.content).toBe('Hello World');
      expect(pending.contentLength).toBe(11);
    });

    it('should persist non-stream events to meta.events', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      const toolCallEvent: AgentEvent = {
        type: 'tool_call',
        callId: 'tc_123',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 1,
        at: Date.now(),
      };

      pending.handleEvent(toolCallEvent);

      expect(msg.meta!.events).toHaveLength(1);
      expect(msg.meta!.events[0]).toEqual(toolCallEvent);
    });

    it('should not persist LLM_CALL tool events', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      pending.handleEvent({
        type: 'tool_call',
        callId: 'tc_123',
        toolName: ToolIds.LLM_CALL,
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      });

      expect(msg.meta!.events).toHaveLength(0);
    });

    it('should set content on error event', () => {
      const msg = createMessage();
      msg.content = 'some previous content';
      const pending = new PendingMessage(msg, createPersister());

      pending.handleEvent({
        type: 'error',
        error: 'Something went wrong',
        seq: 1,
        at: Date.now(),
      });

      expect(msg.content).toBe('Something went wrong');
      expect(msg.meta!.events).toHaveLength(1);
    });

    it('should initialize meta if not present', () => {
      const msg = createMessage();
      (msg as any).meta = undefined;
      const pending = new PendingMessage(msg, createPersister());

      pending.handleEvent({
        type: 'tool_result',
        callId: 'tc_123',
        toolName: 'search',
        output: { results: [] },
        seq: 1,
        at: Date.now(),
      });

      expect(msg.meta).toBeDefined();
      expect(msg.meta!.events).toHaveLength(1);
    });

    it('should handle multiple event types in sequence', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      // Start event
      pending.handleEvent({ type: 'start', seq: 1, at: Date.now() });

      // Stream content
      pending.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 2,
        at: Date.now(),
      });

      // Tool call (non-LLM)
      pending.handleEvent({
        type: 'tool_call',
        callId: 'tc_123',
        toolName: 'search',
        toolArgs: { query: 'test' },
        seq: 3,
        at: Date.now(),
      });

      // Tool result
      pending.handleEvent({
        type: 'tool_result',
        callId: 'tc_123',
        toolName: 'search',
        output: { results: ['a', 'b'] },
        seq: 4,
        at: Date.now(),
      });

      // More stream
      pending.handleEvent({
        type: 'stream',
        content: '!',
        seq: 5,
        at: Date.now(),
      });

      // Final
      pending.handleEvent({ type: 'final', seq: 6, at: Date.now() });

      expect(msg.content).toBe('Hello!');
      expect(msg.meta!.events).toHaveLength(4); // start, tool_call, tool_result, final
    });
  });

  describe('contentLength', () => {
    it('should return 0 for empty content', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      expect(pending.contentLength).toBe(0);
    });

    it('should return correct length after accumulation', () => {
      const msg = createMessage();
      msg.content = 'Initial';
      const pending = new PendingMessage(msg, createPersister());

      pending.handleEvent({
        type: 'stream',
        content: ' content',
        seq: 1,
        at: Date.now(),
      });

      expect(pending.contentLength).toBe(15);
    });
  });

  describe('finalize', () => {
    it('should call persister with the message', async () => {
      const msg = createMessage();
      const persister = vi.fn().mockResolvedValue(undefined);
      const pending = new PendingMessage(msg, persister);

      pending.handleEvent({
        type: 'stream',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      });

      await pending.finalize();

      expect(persister).toHaveBeenCalledWith(msg);
      expect(persister).toHaveBeenCalledTimes(1);
    });
  });

  describe('toMessage', () => {
    it('should return the underlying message', () => {
      const msg = createMessage();
      const pending = new PendingMessage(msg, createPersister());

      expect(pending.toMessage()).toBe(msg);
    });
  });
});
