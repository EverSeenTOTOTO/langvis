import { describe, it, expect, vi } from 'vitest';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import type { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import type { MemoryPort } from '@/server/modules/memory/domain/port/memory.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
import type { ContextUsage } from '@/server/modules/memory/domain/model/memory.types';

function makeMockTool(config?: {
  untrustedOutput?: boolean;
  compression?: 'skip' | 'file';
}): Tool {
  return {
    id: 'mock-tool',
    config: config ?? {},
    call: vi.fn().mockImplementation(function* () {
      return 'tool output';
    }),
  } as unknown as Tool;
}

function makeMockCache(): CachePort {
  return {
    resolve: vi.fn(async (_id: string, value: unknown) => value),
    compress: vi.fn(async (_id: string, value: unknown) => value),
    readFile: vi.fn(),
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

function makeMockMemory(): MemoryPort {
  return {
    buildContext: vi.fn().mockResolvedValue([]),
    getContextUsage: vi
      .fn()
      .mockReturnValue({ used: 0, total: 8000 } as ContextUsage),
  };
}

function makeMockRun(): AgentRun {
  const RuntimeConfigVOMock = {
    agentId: 'test',
    agentName: 'test',
    systemPrompt: '',
    tools: [],
    contextSize: 8000,
    runtimeConfig: {},
  } as unknown as RuntimeConfigVO;

  const run = new AgentRun(
    'run_1',
    'msg_1',
    '/tmp/workdir',
    RuntimeConfigVOMock,
    {
      id: 'test-agent',
      call: vi.fn(),
      config: {},
      tools: [],
      logger: {} as any,
    } as unknown as any,
    makeMockMemory(),
    makeMockCache(),
    makeMockLlm(),
  );
  return run;
}

function createToolCall(tool?: Tool): ToolCall {
  return new ToolCall(
    'tc_1',
    tool ?? makeMockTool(),
    { input: 'test' },
    makeMockCache(),
    makeMockRun(),
  );
}

describe('ToolCall', () => {
  describe('execute', () => {
    it('should resolve input args from cache first', async () => {
      const cache = makeMockCache();
      const run = makeMockRun();
      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        { input: 'test' },
        cache,
        run,
      );

      const gen = toolCall.execute();
      for await (const _ of gen) {
        /* consume generator */
      }

      expect(cache.resolve).toHaveBeenCalledWith('run_1', { input: 'test' });
    });

    it('should emit tool_call event via run delegation', async () => {
      const run = makeMockRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        { input: 'test' },
        makeMockCache(),
        run,
      );

      const gen = toolCall.execute();
      for await (const _ of gen) {
        /* consume */
      }

      const callEvent = events.find(e => e.type === 'tool_call');
      expect(callEvent).toBeDefined();
      expect(callEvent.callId).toBe('tc_1');
      expect(callEvent.toolName).toBe('mock-tool');
    });

    it('should emit tool_result on successful execution', async () => {
      const run = makeMockRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        { input: 'test' },
        makeMockCache(),
        run,
      );

      const gen = toolCall.execute();
      for await (const _ of gen) {
        /* consume */
      }

      const resultEvent = events.find(e => e.type === 'tool_result');
      expect(resultEvent).toBeDefined();
      expect(toolCall.status).toBe('completed');
    });

    it('should emit tool_error on tool exception', async () => {
      const failingTool: Tool = {
        id: 'fail-tool',
        config: {},
        call: vi.fn().mockImplementation(function* () {
          throw new Error('Tool crashed');
        }),
      } as unknown as Tool;

      const run = makeMockRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const toolCall = new ToolCall(
        'tc_fail',
        failingTool,
        {},
        makeMockCache(),
        run,
      );

      const gen = toolCall.execute();
      for await (const _ of gen) {
        /* consume */
      }

      const errorEvent = events.find(e => e.type === 'tool_error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBe('Tool crashed');
      expect(toolCall.status).toBe('failed');
    });
  });

  describe('emitProgress delegation', () => {
    it('should delegate emitProgress to run.emitToolProgress', () => {
      const run = makeMockRun();
      const events: any[] = [];
      run.on('run:event', (e: any) => events.push(e));

      const toolCall = new ToolCall(
        'tc_prog',
        makeMockTool(),
        {},
        makeMockCache(),
        run,
      );

      toolCall.emitProgress({ status: 'working' });

      expect(events[0].type).toBe('tool_progress');
      expect(events[0].callId).toBe('tc_prog');
      expect(events[0].data).toEqual({ status: 'working' });
    });
  });

  describe('convenience getters from run', () => {
    it('should delegate signal, workDir, messageId, runId, llm to run', () => {
      const run = makeMockRun();
      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        {},
        makeMockCache(),
        run,
      );

      expect(toolCall.signal).toBe(run.signal);
      expect(toolCall.workDir).toBe(run.workDir);
      expect(toolCall.messageId).toBe(run.messageId);
      expect(toolCall.runId).toBe(run.runId);
      expect(toolCall.llm).toBe(run.llm);
    });
  });

  describe('observation', () => {
    it('should return raw output for trusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: false }));
      (toolCall as any).doComplete('raw output');

      expect(toolCall.observation).toBe('raw output');
    });

    it('should wrap output in untrusted_content tags for untrusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: true }));
      (toolCall as any).doComplete('external content');

      expect(toolCall.observation).toContain('<untrusted_content>');
      expect(toolCall.observation).toContain('external content');
      expect(toolCall.observation).toContain('</untrusted_content>');
    });

    it('should return error message for failed status', () => {
      const toolCall = createToolCall();
      (toolCall as any).doFail('something went wrong');

      expect(toolCall.observation).toContain('Error executing tool');
      expect(toolCall.observation).toContain('something went wrong');
    });

    it('should stringify non-string output', () => {
      const toolCall = createToolCall();
      (toolCall as any).doComplete({ key: 'value' });

      expect(toolCall.observation).toBe(JSON.stringify({ key: 'value' }));
    });
  });

  describe('status transitions', () => {
    it('should start in pending status', () => {
      const toolCall = createToolCall();
      expect(toolCall.status).toBe('pending');
    });

    it('should transition to completed', () => {
      const toolCall = createToolCall();
      (toolCall as any).doComplete('output');
      expect(toolCall.status).toBe('completed');
    });

    it('should transition to failed', () => {
      const toolCall = createToolCall();
      (toolCall as any).doFail('error');
      expect(toolCall.status).toBe('failed');
    });
  });

  describe('toRecord', () => {
    it('should produce a ToolCallRecord snapshot', () => {
      const toolCall = createToolCall();
      (toolCall as any).doComplete('output');

      const record = toolCall.toRecord();
      expect(record.callId).toBe('tc_1');
      expect(record.toolName).toBe('mock-tool');
      expect(record.status).toBe('completed');
      expect(record.duration).toBeGreaterThanOrEqual(0);
      expect(record.startedAt).toBeGreaterThan(0);
      expect(record.completedAt).toBeGreaterThan(0);
    });
  });
});
