import { describe, it, expect, vi } from 'vitest';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import { RunAlreadyCompletedError } from '@/server/modules/agent/domain/errors';
import type { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { MemoryPort } from '@/server/modules/memory/domain/port/memory.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
import type { ContextUsage } from '@/server/modules/memory/domain/model/memory.types';
import type { AgentConfig, AgentBinding } from '@/shared/types';

function makeRuntimeConfigVO(): RuntimeConfigVO {
  const agentConfig: AgentConfig = {
    name: 'Test Agent',
    description: 'test',
    tools: [],
  };
  const binding: AgentBinding = {
    agentId: 'test-agent',
    config: {},
  };
  return RuntimeConfigVO.create(agentConfig, binding, 'You are helpful', 8000);
}

function makeMockMemory(): MemoryPort {
  return {
    buildContext: vi.fn().mockResolvedValue([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]),
    getContextUsage: vi
      .fn()
      .mockReturnValue({ used: 100, total: 8000 } as ContextUsage),
  };
}

function makeMockCache(): CachePort {
  return {
    resolve: vi.fn().mockResolvedValue({}),
    compress: vi.fn().mockResolvedValue('compressed'),
    readFile: vi.fn().mockResolvedValue('data'),
  };
}

function makeMockLlm(): LlmPort {
  return {
    chat: vi.fn(),
    chatContent: vi.fn(),
    embed: vi.fn(),
    tts: vi.fn(),
    stt: vi.fn(),
  } as unknown as LlmPort;
}

function makeMockAgent(): Agent {
  return {
    id: 'test-agent',
    config: { name: 'Test Agent', description: 'test', tools: [] },
    call: vi.fn().mockImplementation(function* () {
      // yields nothing, just completes
    }),
    systemPrompt: { build: vi.fn().mockReturnValue('') } as any,
    logger: {} as any,
    tools: [],
  } as unknown as Agent;
}

function createRun(): AgentRun {
  return new AgentRun(
    'run_1',
    'msg_1',
    '/tmp/workdir',
    makeRuntimeConfigVO(),
    makeMockAgent(),
    makeMockMemory(),
    makeMockCache(),
    makeMockLlm(),
  );
}

describe('AgentRun', () => {
  describe('aggregate root', () => {
    it('should use id as canonical identity with runId getter', () => {
      const run = createRun();
      expect(run.id).toBe('run_1');
      expect(run.runId).toBe('run_1');
    });

    it('should support EventEmitter via on()', () => {
      const run = createRun();
      const handler = vi.fn();
      run.on('run:event', handler);
      run.emitTextChunk('test');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should emit start event and final event on success', async () => {
      const mockAgent = makeMockAgent();
      mockAgent.call = vi.fn().mockImplementation(function* (run: AgentRun) {
        run.emitTextChunk('chunk');
      });

      const run = new AgentRun(
        'run_ok',
        'msg_ok',
        '/tmp',
        makeRuntimeConfigVO(),
        mockAgent,
        makeMockMemory(),
        makeMockCache(),
        makeMockLlm(),
      );

      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      await run.execute();

      expect(events[0].type).toBe('start');
      const finalEvents = events.filter(e => e.type === 'final');
      expect(finalEvents).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('should emit cancelled event and abort', () => {
      const run = createRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      run.cancel('user abort');

      expect(run.signal.aborted).toBe(true);
      expect(events[0].type).toBe('cancelled');
      expect(events[0].reason).toBe('user abort');
    });

    it('should not double-cancel', () => {
      const run = createRun();
      run.cancel('first');

      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));
      run.cancel('second');

      expect(events).toHaveLength(0);
    });
  });

  describe('complete / fail', () => {
    it('should emit final event on complete', () => {
      const run = createRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const event = run.complete();

      expect(event.type).toBe('final');
      expect(run.isTerminated).toBe(true);
    });

    it('should throw RunAlreadyCompletedError on second complete', () => {
      const run = createRun();
      run.complete();

      expect(() => run.complete()).toThrow(RunAlreadyCompletedError);
    });

    it('should emit error event on fail', () => {
      const run = createRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const event = run.fail('something went wrong');

      expect(event.type).toBe('error');
      expect((event as any).error).toBe('something went wrong');
      expect(run.isTerminated).toBe(true);
    });

    it('should throw RunAlreadyCompletedError on fail after complete', () => {
      const run = createRun();
      run.complete();

      expect(() => run.fail('error')).toThrow(RunAlreadyCompletedError);
    });
  });

  describe('enrichAndEmit — seq numbering', () => {
    it('should increment seq counter for each event', () => {
      const run = createRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      run.emitTextChunk('a');
      run.emitTextChunk('b');
      run.emitThought('thinking');

      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
      expect(events[2].seq).toBe(3);
    });

    it('should include runId and timestamp in each event', () => {
      const run = createRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      run.emitTextChunk('test');

      expect(events[0].runId).toBe('run_1');
      expect(events[0].at).toBeGreaterThan(0);
    });
  });

  describe('isTerminated', () => {
    it('should be false initially', () => {
      const run = createRun();
      expect(run.isTerminated).toBe(false);
    });

    it('should be true after complete', () => {
      const run = createRun();
      run.complete();
      expect(run.isTerminated).toBe(true);
    });

    it('should be true after cancel', () => {
      const run = createRun();
      run.cancel('abort');
      expect(run.isTerminated).toBe(true);
    });

    it('should be true after fail', () => {
      const run = createRun();
      run.fail('error');
      expect(run.isTerminated).toBe(true);
    });
  });
});
