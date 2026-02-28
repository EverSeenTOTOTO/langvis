import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@/client/store/modules/ConversationState';
import { Role } from '@/shared/types/entities';

describe('ConversationState', () => {
  let state: ConversationState;

  beforeEach(() => {
    state = new ConversationState();
  });

  describe('initialization', () => {
    it('should initialize with idle phase', () => {
      expect(state.phase).toBe('idle');
      expect(state.phaseError).toBeNull();
      expect(state.buffer).toBe('');
      expect(state.streamingMessage).toBeNull();
      expect(state.pendingMessageIds).toEqual([]);
    });
  });

  describe('isLoading', () => {
    it('should return false when idle', () => {
      expect(state.isLoading).toBe(false);
    });

    it('should return true when connecting', () => {
      state.setPhase('connecting');
      expect(state.isLoading).toBe(true);
    });

    it('should return true when streaming', () => {
      state.setPhase('streaming');
      expect(state.isLoading).toBe(true);
    });

    it('should return true when finishing', () => {
      state.setPhase('finishing');
      expect(state.isLoading).toBe(true);
    });

    it('should return false when error', () => {
      state.setPhase('error', 'Test error');
      expect(state.isLoading).toBe(false);
    });

    it('should return false when cancelled', () => {
      state.setPhase('cancelled');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('hasContent', () => {
    it('should return false when no content', () => {
      expect(state.hasContent).toBe(false);
    });

    it('should return true when streamingMessage has content', () => {
      state.setStreamingMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: Role.ASSIST,
        content: 'Hello',
        createdAt: new Date(),
      });

      expect(state.hasContent).toBe(true);
    });

    it('should return true when buffer has content', () => {
      state.appendBuffer('Hello');

      expect(state.hasContent).toBe(true);
    });
  });

  describe('phase transitions', () => {
    it('should transition from idle to connecting', () => {
      state.transition('connecting');
      expect(state.phase).toBe('connecting');
    });

    it('should transition from connecting to streaming', () => {
      state.setPhase('connecting');
      state.transition('streaming');
      expect(state.phase).toBe('streaming');
    });

    it('should transition from streaming to finishing', () => {
      state.setPhase('streaming');
      state.transition('finishing');
      expect(state.phase).toBe('finishing');
    });

    it('should not transition from terminal states', () => {
      state.setPhase('error', 'Test error');
      state.transition('streaming');

      expect(state.phase).toBe('error');
    });

    it('should transition from finishing to idle', () => {
      state.setPhase('finishing');
      state.transition('idle');

      expect(state.phase).toBe('idle');
    });
  });

  describe('setPhase', () => {
    it('should set phase and error', () => {
      state.setPhase('error', 'Something went wrong');

      expect(state.phase).toBe('error');
      expect(state.phaseError).toBe('Something went wrong');
    });
  });

  describe('buffer and typewriter', () => {
    it('should append to buffer', () => {
      state.appendBuffer('Hello');
      state.appendBuffer(' World');

      expect(state.buffer).toBe('Hello World');
    });

    it('should start timer when appending to buffer', () => {
      state.appendBuffer('Hello');

      expect(state.timer).not.toBeNull();
    });

    it('should flush buffer immediately', () => {
      state.setStreamingMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: Role.ASSIST,
        content: '',
        createdAt: new Date(),
      });

      state.appendBuffer('Hello');
      state.flushBufferImmediately();

      expect(state.buffer).toBe('');
      expect(state.streamingMessage?.content).toBe('Hello');
    });

    it('should clear timer on flush', () => {
      state.appendBuffer('Hello');
      state.flushBufferImmediately();

      expect(state.timer).toBeNull();
    });
  });

  describe('EventSource management', () => {
    it('should set eventSource', () => {
      const mockES = { close: vi.fn() } as any;
      state.setEventSource(mockES);

      expect(state.eventSource).toBe(mockES);
    });

    it('should close eventSource', () => {
      const mockES = { close: vi.fn() } as any;
      state.setEventSource(mockES);
      state.closeEventSource();

      expect(mockES.close).toHaveBeenCalled();
      expect(state.eventSource).toBeNull();
    });
  });

  describe('pendingMessageIds', () => {
    it('should add pending message ids', () => {
      state.addPendingMessageId('msg-1');
      state.addPendingMessageId('msg-2');

      expect(state.pendingMessageIds).toEqual(['msg-1', 'msg-2']);
    });

    it('should clear pending message ids', () => {
      state.addPendingMessageId('msg-1');
      state.addPendingMessageId('msg-2');
      state.clearPendingMessageIds();

      expect(state.pendingMessageIds).toEqual([]);
    });
  });

  describe('streamingMessage', () => {
    it('should set streaming message', () => {
      const msg = {
        id: 'msg-1',
        conversationId: 'conv-1',
        role: Role.ASSIST,
        content: '',
        createdAt: new Date(),
      };

      state.setStreamingMessage(msg);

      expect(state.streamingMessage).toEqual(msg);
    });
  });

  describe('appendEvent', () => {
    it('should append event to streamingMessage', () => {
      state.setStreamingMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
      });

      const event = {
        type: 'thought' as const,
        content: 'thinking',
        seq: 1,
        at: Date.now(),
      };
      state.appendEvent(event);

      expect(state.streamingMessage?.meta?.events).toContainEqual(event);
    });

    it('should do nothing if no streamingMessage', () => {
      const event = {
        type: 'thought' as const,
        content: 'thinking',
        seq: 1,
        at: Date.now(),
      };
      state.appendEvent(event);

      // Should not throw
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      state.setPhase('streaming');
      state.setStreamingMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: Role.ASSIST,
        content: 'test',
        createdAt: new Date(),
      });
      state.appendBuffer('buffer');
      state.addPendingMessageId('pending-1');
      state.setPhase('error', 'error');

      state.reset();

      expect(state.phase).toBe('idle');
      expect(state.phaseError).toBeNull();
      expect(state.streamingMessage).toBeNull();
      expect(state.buffer).toBe('');
      expect(state.pendingMessageIds).toEqual([]);
    });
  });

  describe('waitForTypewriter', () => {
    it('should call onComplete immediately if no buffer and no timer', async () => {
      const onComplete = vi.fn();

      state.waitForTypewriter(onComplete);

      // Wait for the first setTimeout(50ms) in waitForTypewriter
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onComplete).toHaveBeenCalled();
    });
  });
});
