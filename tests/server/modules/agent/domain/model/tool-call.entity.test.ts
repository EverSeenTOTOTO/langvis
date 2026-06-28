import { describe, it, expect, vi } from 'vitest';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { RunEvent } from '@/shared/types/events';

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

function makeDeps(): ToolCallDeps {
  return {
    signal: new AbortController().signal,
    workDir: '/tmp/workdir',
    runId: 'run_1',
    llm: makeMockLlm(),
    cache: makeMockCache(),
    chatModelId: undefined,
    runtimeConfig: {},
  };
}

function createToolCall(tool?: Tool, deps?: ToolCallDeps): ToolCall {
  return new ToolCall(
    'tc_1',
    tool ?? makeMockTool(),
    { input: 'test' },
    (deps ?? makeDeps()).cache,
    deps ?? makeDeps(),
  );
}

async function collect(
  gen: AsyncGenerator<RunEvent, string>,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('ToolCall', () => {
  describe('execute', () => {
    it('resolves input args and compresses output keyed by workDir', async () => {
      const deps = makeDeps();
      const toolCall = createToolCall(makeMockTool(), deps);
      await collect(toolCall.execute());
      expect(deps.cache.resolve).toHaveBeenCalledWith('/tmp/workdir', {
        input: 'test',
      });
      expect(deps.cache.compress).toHaveBeenCalledWith(
        '/tmp/workdir',
        'tool output',
        undefined,
      );
    });

    it('yields tool_call then tool_result on success', async () => {
      const toolCall = createToolCall();
      const events = await collect(toolCall.execute());
      expect(events[0].type).toBe('tool_call');
      expect((events[0] as any).callId).toBe('tc_1');
      expect((events[0] as any).toolName).toBe('mock-tool');
      expect(events[events.length - 1].type).toBe('tool_result');
      expect(toolCall.status).toBe('completed');
    });

    it('yields tool_error on tool exception', async () => {
      const failingTool: Tool = {
        id: 'fail-tool',
        config: {},
        call: vi.fn().mockImplementation(function* () {
          throw new Error('Tool crashed');
        }),
      } as unknown as Tool;

      const toolCall = createToolCall(failingTool);
      const events = await collect(toolCall.execute());
      const errorEvent = events.find(e => e.type === 'tool_error') as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBe('Tool crashed');
      expect(toolCall.status).toBe('failed');
    });

    it('returns the observation string', async () => {
      const toolCall = createToolCall();
      const gen = toolCall.execute();
      let observation = '';
      // drive to completion and read return value
      while (true) {
        const r = await gen.next();
        if (r.done) {
          observation = r.value;
          break;
        }
      }
      expect(observation).toBe('tool output');
    });
  });

  describe('deps getters', () => {
    it('exposes signal/workDir/runId/llm from deps', () => {
      const deps = makeDeps();
      const toolCall = createToolCall(makeMockTool(), deps);
      expect(toolCall.signal).toBe(deps.signal);
      expect(toolCall.workDir).toBe('/tmp/workdir');
      expect(toolCall.runId).toBe('run_1');
      expect(toolCall.llm).toBe(deps.llm);
    });
  });

  describe('observation', () => {
    it('returns raw output for trusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: false }));
      (toolCall as any).complete('raw output');
      expect(toolCall.observation).toBe('raw output');
    });

    it('wraps output for untrusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: true }));
      (toolCall as any).complete('external content');
      expect(toolCall.observation).toContain('<untrusted_content>');
      expect(toolCall.observation).toContain('external content');
    });

    it('returns error message for failed status', () => {
      const toolCall = createToolCall();
      (toolCall as any).fail('something went wrong');
      expect(toolCall.observation).toContain('Error executing tool');
      expect(toolCall.observation).toContain('something went wrong');
    });

    it('stringifies non-string output', () => {
      const toolCall = createToolCall();
      (toolCall as any).complete({ key: 'value' });
      expect(toolCall.observation).toBe(JSON.stringify({ key: 'value' }));
    });
  });

  describe('status transitions', () => {
    it('starts pending', () => {
      expect(createToolCall().status).toBe('pending');
    });
    it('transitions to completed', () => {
      const tc = createToolCall();
      (tc as any).complete('output');
      expect(tc.status).toBe('completed');
    });
    it('transitions to failed', () => {
      const tc = createToolCall();
      (tc as any).fail('error');
      expect(tc.status).toBe('failed');
    });
  });
});
