import { describe, it, expect, vi } from 'vitest';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { ListMonad } from '@/server/libs/list';
import type { RunEvent } from '@/shared/types/events';

function makeMockTool(config?: { untrustedOutput?: boolean }): Tool {
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
    offload: vi.fn(async (_id: string, _value: unknown) => ({
      $cached: 'fc_test',
      $size: 0,
      $preview: '',
    })),
  };
}

function noopAuth(): AuthorizationPort {
  return {
    ensureApproved: async function* () {
      /* test 不验证授权 */
    },
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

function makeCtx(): AgentRunContext {
  const config = RunConfigVO.of({ tools: [], runtimeConfig: {} });
  return {
    run: new AgentRun('run_1', config),
    config,
    runId: 'run_1',
    workDir: '/tmp/workdir',
    conversationId: 'conv_1',
    signal: new AbortController().signal,
    llm: makeMockLlm(),
    cache: makeMockCache(),
    auth: noopAuth(),
    messages: ListMonad.of([]),
    base: 0,
    interactive: true,
  };
}

function createToolCall(tool?: Tool, ctx?: AgentRunContext): ToolCall {
  return new ToolCall(
    'tc_1',
    tool ?? makeMockTool(),
    { input: 'test' },
    ctx ?? makeCtx(),
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
    it('passes input args through and leaves output uncompressed (full text in #output)', async () => {
      const ctx = makeCtx();
      const toolCall = createToolCall(makeMockTool(), ctx);
      await collect(toolCall.execute());
      // 不存在自动 resolve：入参原样直用。
      expect(ctx.cache.resolve).not.toHaveBeenCalled();
      // tool-call 层不落盘：#output 留全文（事件/DB/前端真相），
      // 给 LLM 的 messages 由 pre-LLM offload-hook 预算化桩化。
      expect(ctx.cache.offload).not.toHaveBeenCalled();
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

  describe('ctx getters', () => {
    it('exposes signal/workDir/runId/llm from ctx', () => {
      const ctx = makeCtx();
      const toolCall = createToolCall(makeMockTool(), ctx);
      expect(toolCall.signal).toBe(ctx.signal);
      expect(toolCall.workDir).toBe('/tmp/workdir');
      expect(toolCall.runId).toBe('run_1');
      expect(toolCall.llm).toBe(ctx.llm);
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
