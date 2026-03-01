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
      state.transition('connecting');
      expect(state.isLoading).toBe(true);
    });

    it('should return true when streaming', () => {
      state.transition('connecting');
      state.transition('streaming');
      expect(state.isLoading).toBe(true);
    });

    it('should return true when finishing', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('finishing');
      expect(state.isLoading).toBe(true);
    });

    it('should return false when error', () => {
      state.transition('connecting');
      state.transition('error', 'Test error');
      expect(state.isLoading).toBe(false);
    });

    it('should return false when cancelled', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('cancelled');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('phase transitions', () => {
    it('should transition from idle to connecting', () => {
      state.transition('connecting');
      expect(state.phase).toBe('connecting');
    });

    it('should transition from connecting to streaming', () => {
      state.transition('connecting');
      state.transition('streaming');
      expect(state.phase).toBe('streaming');
    });

    it('should transition from connecting to error', () => {
      state.transition('connecting');
      state.transition('error', 'Connection failed');
      expect(state.phase).toBe('error');
      expect(state.phaseError).toBe('Connection failed');
    });

    it('should transition from connecting to cancelled', () => {
      state.transition('connecting');
      state.transition('cancelled');
      expect(state.phase).toBe('cancelled');
    });

    it('should transition from streaming to finishing', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('finishing');
      expect(state.phase).toBe('finishing');
    });

    it('should transition from streaming to error', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('error', 'Stream error');
      expect(state.phase).toBe('error');
      expect(state.phaseError).toBe('Stream error');
    });

    it('should transition from streaming to cancelled', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('cancelled');
      expect(state.phase).toBe('cancelled');
    });

    it('should transition from finishing to idle', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('finishing');
      state.transition('idle');
      expect(state.phase).toBe('idle');
    });

    it('should transition from finishing to error', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('finishing');
      state.transition('error', 'Finish error');
      expect(state.phase).toBe('error');
    });

    it('should not transition from idle to streaming', () => {
      state.transition('streaming');
      expect(state.phase).toBe('idle');
    });

    it('should not transition from terminal state error', () => {
      state.transition('connecting');
      state.transition('error', 'Failed');
      state.transition('idle');
      expect(state.phase).toBe('error');
    });

    it('should not transition from terminal state cancelled', () => {
      state.transition('connecting');
      state.transition('streaming');
      state.transition('cancelled');
      state.transition('idle');
      expect(state.phase).toBe('cancelled');
    });
  });

  describe('EventSource management', () => {
    it('should set eventSource', () => {
      const mockES = { close: vi.fn() } as unknown as EventSource;
      state.setEventSource(mockES);
      expect(state.eventSource).toBe(mockES);
    });

    it('should close eventSource', () => {
      const mockES = { close: vi.fn() } as unknown as EventSource;
      state.setEventSource(mockES);
      state.closeEventSource();
      expect(mockES.close).toHaveBeenCalled();
      expect(state.eventSource).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state from terminal state', () => {
      state.transition('connecting');
      state.transition('error', 'error');
      state.reset();
      expect(state.phase).toBe('idle');
      expect(state.phaseError).toBeNull();
    });

    it('should close eventSource on reset', () => {
      const mockES = { close: vi.fn() } as unknown as EventSource;
      state.setEventSource(mockES);
      state.reset();
      expect(mockES.close).toHaveBeenCalled();
      expect(state.eventSource).toBeNull();
    });
  });
});
