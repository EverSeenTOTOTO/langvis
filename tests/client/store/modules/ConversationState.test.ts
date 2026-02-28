import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@/client/store/modules/ConversationState';

describe('ConversationState', () => {
  let state: ConversationState;

  beforeEach(() => {
    state = new ConversationState();
  });

  describe('initialization', () => {
    it('should initialize with idle phase', () => {
      expect(state.phase).toBe('idle');
      expect(state.phaseError).toBeNull();
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

  describe('reset', () => {
    it('should reset all state', () => {
      state.setPhase('streaming');
      state.setPhase('error', 'error');

      state.reset();

      expect(state.phase).toBe('idle');
      expect(state.phaseError).toBeNull();
    });
  });
});
