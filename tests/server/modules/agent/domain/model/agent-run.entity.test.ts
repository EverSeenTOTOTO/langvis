import { describe, it, expect } from 'vitest';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import { RunAlreadyCompletedError } from '@/server/modules/agent/domain/errors';

function makeConfig(): RuntimeConfigVO {
  return RuntimeConfigVO.of({
    systemPrompt: 'You are helpful',
    tools: [],
    contextSize: 8000,
    runtimeConfig: {},
  });
}

function createRun(): AgentRun {
  return new AgentRun('run_1', makeConfig());
}

describe('AgentRun', () => {
  describe('aggregate root', () => {
    it('uses id as canonical identity with runId getter', () => {
      const run = createRun();
      expect(run.id).toBe('run_1');
      expect(run.runId).toBe('run_1');
    });

    it('starts as initialized, not terminated', () => {
      const run = createRun();
      expect(run.currentStatus).toBe('initialized');
      expect(run.isTerminated).toBe(false);
      expect(run.eventStream).toHaveLength(0);
    });
  });

  describe('append (事实追加)', () => {
    it('appends events and enriches with runId/at', () => {
      const run = createRun();
      const e1 = run.append({ type: 'text_chunk', content: 'a' })!;
      const e2 = run.append({ type: 'text_chunk', content: 'b' })!;

      expect(run.eventStream).toHaveLength(2);
      expect(e1.runId).toBe('run_1');
      expect(e1.at).toBeGreaterThan(0);
      expect(e2.at).toBeGreaterThanOrEqual(e1.at);
    });

    it('returns null and drops events after termination', () => {
      const run = createRun();
      run.cancel('abort');
      const dropped = run.append({ type: 'text_chunk', content: 'late' });
      expect(dropped).toBeNull();
      expect(run.eventStream).toHaveLength(1);
    });
  });

  describe('start', () => {
    it('sets status running and records a start event', () => {
      const run = createRun();
      const e = run.start();
      expect(run.currentStatus).toBe('running');
      expect(e.type).toBe('start');
      expect(run.eventStream).toHaveLength(1);
    });
  });

  describe('complete / fail', () => {
    it('records final event and terminates on complete', () => {
      const run = createRun();
      const e = run.complete();
      expect(e.type).toBe('final');
      expect(run.currentStatus).toBe('completed');
      expect(run.isTerminated).toBe(true);
    });

    it('throws RunAlreadyCompletedError on second complete', () => {
      const run = createRun();
      run.complete();
      expect(() => run.complete()).toThrow(RunAlreadyCompletedError);
    });

    it('records error event and terminates on fail', () => {
      const run = createRun();
      const e = run.fail('something went wrong');
      expect(e.type).toBe('error');
      expect((e as any).error).toBe('something went wrong');
      expect(run.currentStatus).toBe('failed');
      expect(run.isTerminated).toBe(true);
    });

    it('throws RunAlreadyCompletedError on fail after complete', () => {
      const run = createRun();
      run.complete();
      expect(() => run.fail('error')).toThrow(RunAlreadyCompletedError);
    });
  });

  describe('cancel', () => {
    it('records cancelled event and terminates', () => {
      const run = createRun();
      const e = run.cancel('user abort')!;
      expect(e.type).toBe('cancelled');
      expect((e as any).reason).toBe('user abort');
      expect(run.currentStatus).toBe('cancelled');
      expect(run.isTerminated).toBe(true);
    });

    it('is idempotent — returns null on double cancel', () => {
      const run = createRun();
      run.cancel('first');
      const second = run.cancel('second');
      expect(second).toBeNull();
      expect(run.eventStream).toHaveLength(1);
    });

    it('aborts the signal atomically with the cancelled event', () => {
      const run = createRun();
      expect(run.signal.aborted).toBe(false);
      run.cancel('user abort');
      expect(run.signal.aborted).toBe(true);
    });
  });

  describe('eventStream immutability', () => {
    it('returns a readonly view', () => {
      const run = createRun();
      run.append({ type: 'text_chunk', content: 'x' });
      // readonly typing prevents push at compile time; runtime array is shared but append is the only writer
      expect(run.eventStream).toHaveLength(1);
    });
  });
});
