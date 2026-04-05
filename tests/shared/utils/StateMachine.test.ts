import { describe, it, expect, vi } from 'vitest';
import { StateMachine } from '@/shared/utils/StateMachine';

type TestPhase = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

const TRANSITIONS: Record<TestPhase, TestPhase[]> = {
  idle: ['running'],
  running: ['paused', 'stopped', 'error'],
  paused: ['running', 'stopped'],
  stopped: [],
  error: [],
};

describe('StateMachine', () => {
  describe('initial state', () => {
    it('should initialize with the given phase', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      expect(sm.phase).toBe('idle');
    });
  });

  describe('canTransitionTo', () => {
    it('should return true for valid transitions', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      expect(sm.canTransitionTo('running')).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      expect(sm.canTransitionTo('paused')).toBe(false);
      expect(sm.canTransitionTo('stopped')).toBe(false);
    });
  });

  describe('transition', () => {
    it('should change phase and return true on valid transition', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      const result = sm.transition('running');
      expect(result).toBe(true);
      expect(sm.phase).toBe('running');
    });

    it('should return false and not change phase on invalid transition', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      const result = sm.transition('paused');
      expect(result).toBe(false);
      expect(sm.phase).toBe('idle');
    });

    it('should not allow transitions from terminal state', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      sm.transition('running');
      sm.transition('stopped');
      expect(sm.canTransitionTo('idle')).toBe(false);
      expect(sm.transition('idle')).toBe(false);
    });
  });

  describe('onTransition callback', () => {
    it('should call onTransition with (from, to) on valid transition', () => {
      const cb = vi.fn();
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
        onTransition: cb,
      });

      sm.transition('running');

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith('idle', 'running');
    });

    it('should NOT call onTransition on invalid transition', () => {
      const cb = vi.fn();
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
        onTransition: cb,
      });

      sm.transition('paused');

      expect(cb).not.toHaveBeenCalled();
    });

    it('should call onTransition for each step in a chain', () => {
      const cb = vi.fn();
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
        onTransition: cb,
      });

      sm.transition('running');
      sm.transition('paused');
      sm.transition('running');
      sm.transition('stopped');

      expect(cb).toHaveBeenCalledTimes(4);
      expect(cb).toHaveBeenLastCalledWith('running', 'stopped');
    });
  });

  describe('silentTransition', () => {
    it('should change phase and return true without calling onTransition', () => {
      const cb = vi.fn();
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
        onTransition: cb,
      });

      const result = sm.silentTransition('running');

      expect(result).toBe(true);
      expect(sm.phase).toBe('running');
      expect(cb).not.toHaveBeenCalled();
    });

    it('should return false on invalid transition', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });
      const result = sm.silentTransition('paused');
      expect(result).toBe(false);
      expect(sm.phase).toBe('idle');
    });
  });

  describe('chained transitions', () => {
    it('should support multiple transitions in sequence', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });

      sm.transition('running');
      expect(sm.phase).toBe('running');

      sm.transition('paused');
      expect(sm.phase).toBe('paused');

      sm.transition('running');
      expect(sm.phase).toBe('running');

      sm.transition('stopped');
      expect(sm.phase).toBe('stopped');
    });
  });

  describe('without onTransition callback', () => {
    it('should work normally without onTransition callback', () => {
      // No callback provided
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });

      // Should not throw
      expect(() => sm.transition('running')).not.toThrow();
      expect(sm.phase).toBe('running');
    });

    it('should return true for valid transition without callback', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });

      const result = sm.transition('running');

      expect(result).toBe(true);
      expect(sm.phase).toBe('running');
    });

    it('should return false for invalid transition without callback', () => {
      const sm = new StateMachine({
        initialPhase: 'idle',
        transitions: TRANSITIONS,
      });

      const result = sm.transition('stopped');

      expect(result).toBe(false);
      expect(sm.phase).toBe('idle');
    });
  });
});
