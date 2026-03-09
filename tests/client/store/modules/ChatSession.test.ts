import { ChatSession } from '@/client/store/modules/ChatSession';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ChatSession', () => {
  let session: ChatSession;

  beforeEach(() => {
    session = new ChatSession('test-conversation', {
      onEvent: vi.fn(),
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
