import { describe, it, expect, vi } from 'vitest';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
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
    messageId: 'msg_1',
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
    it('resolves input args from cache first (keyed by runId)', async () => {
      const deps = makeDeps();
      const toolCall = createToolCall(makeMockTool(), deps);
      await collect(toolCall.execute());
      expect(deps.cache.resolve).toHaveBeenCalledWith('run_1', {
        input: 'test',
      });
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

  describe('emitProgress', () => {
    it('returns a raw tool_progress RunEvent', () => {
      const toolCall = createToolCall();
      const event = toolCall.emitProgress({ status: 'working' }) as any;
      expect(event.type).toBe('tool_progress');
      expect(event.callId).toBe('tc_1');
      expect(event.data).toEqual({ status: 'working' });
    });
  });

  describe('deps getters', () => {
    it('exposes signal/workDir/runId/messageId/llm from deps', () => {
      const deps = makeDeps();
      const toolCall = createToolCall(makeMockTool(), deps);
      expect(toolCall.signal).toBe(deps.signal);
      expect(toolCall.workDir).toBe('/tmp/workdir');
      expect(toolCall.runId).toBe('run_1');
      expect(toolCall.messageId).toBe('msg_1');
      expect(toolCall.llm).toBe(deps.llm);
    });
  });

  describe('observation', () => {
    it('returns raw output for trusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: false }));
      (toolCall as any).doComplete('raw output');
      expect(toolCall.observation).toBe('raw output');
    });

    it('wraps output for untrusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: true }));
      (toolCall as any).doComplete('external content');
      expect(toolCall.observation).toContain('<untrusted_content>');
      expect(toolCall.observation).toContain('external content');
    });

    it('returns error message for failed status', () => {
      const toolCall = createToolCall();
      (toolCall as any).doFail('something went wrong');
      expect(toolCall.observation).toContain('Error executing tool');
      expect(toolCall.observation).toContain('something went wrong');
    });

    it('stringifies non-string output', () => {
      const toolCall = createToolCall();
      (toolCall as any).doComplete({ key: 'value' });
      expect(toolCall.observation).toBe(JSON.stringify({ key: 'value' }));
    });
  });

  describe('status transitions', () => {
    it('starts pending', () => {
      expect(createToolCall().status).toBe('pending');
    });
    it('transitions to completed', () => {
      const tc = createToolCall();
      (tc as any).doComplete('output');
      expect(tc.status).toBe('completed');
    });
    it('transitions to failed', () => {
      const tc = createToolCall();
      (tc as any).doFail('error');
      expect(tc.status).toBe('failed');
    });
  });
});
