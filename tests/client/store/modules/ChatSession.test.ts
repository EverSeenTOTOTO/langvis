import { ChatSession } from '@/client/store/modules/ChatSession';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ChatSession', () => {
  let session: ChatSession;
  let onEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onEvent = vi.fn();
    session = new ChatSession('test-conversation', {
      onEvent,
      onError: vi.fn(),
    });
  });

  describe('phase transitions', () => {
    it('should start in idle state', () => {
      expect(session.phase).toBe('idle');
      expect(session.isLoading).toBe(false);
    });

    it('should transition from idle to connecting', () => {
      session.connect();
      // connect() calls reset() first, then transitions to connecting
      expect(session.phase).toBe('connecting');
      expect(session.isLoading).toBe(true);
    });

    it('should transition from connecting to cancelled', () => {
      session.connect();
      session.cancel();
      expect(session.phase).toBe('cancelled');
      expect(session.isLoading).toBe(false);
    });

    it('should not cancel when already idle', () => {
      session.cancel();
      expect(session.phase).toBe('idle');
    });
  });

  describe('reconnection scenario', () => {
    it('should transition to streaming on any business event', () => {
      // Simulate reconnection: phase is 'connecting' (no 'start' event received)
      session.connect();
      expect(session.phase).toBe('connecting');

      // Simulate receiving a business event (e.g., stream) without prior 'start'
      session['handleEvent']({
        type: 'stream',
        content: 'hello',
        seq: 1,
        at: Date.now(),
      });

      expect(session.phase).toBe('streaming');
    });

    it('should transition to streaming on tool_call event', () => {
      session.connect();
      expect(session.phase).toBe('connecting');

      session['handleEvent']({
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'test_tool',
        toolArgs: {},
        seq: 1,
        at: Date.now(),
      });

      expect(session.phase).toBe('streaming');
    });
  });

  describe('reset', () => {
    it('should reset to idle from terminal states', () => {
      session.connect();
      session.cancel();
      expect(session.phase).toBe('cancelled');

      session.connect();
      expect(session.phase).toBe('connecting');
    });
  });

  describe('error handling', () => {
    it('should transition to error state', () => {
      session.connect();
      session.fail('Test error');
      expect(session.phase).toBe('error');
      expect(session.phaseError).toBe('Test error');
      expect(session.isLoading).toBe(false);
    });

    it('should not fail when cancelled', () => {
      session.connect();
      session.cancel();
      session.fail('Test error');
      expect(session.phase).toBe('cancelled');
    });
  });
});
