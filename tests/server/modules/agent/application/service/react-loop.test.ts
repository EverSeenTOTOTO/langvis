import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';

import {
  parseResponse,
  runReactLoop,
} from '@/server/modules/agent/application/service/react-loop';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { ListMonad } from '@/server/libs/list';
import { HookPlan, type Hook } from '@/server/modules/agent/domain/model/hook';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { ToolIds } from '@/shared/constants';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';

// ─── parseResponse ──────────────────────────────────────────────────────────

describe('parseResponse', () => {
  it('parses a clean bare JSON object', () => {
    expect(parseResponse('{ "tool": "datetime_get", "input": {} }')).toEqual({
      thought: undefined,
      tool: 'datetime_get',
      input: {},
    });
  });

  it('parses a fenced ```json block', () => {
    expect(
      parseResponse('```json\n{ "tool": "datetime_get", "input": {} }\n```'),
    ).toEqual({
      thought: undefined,
      tool: 'datetime_get',
      input: {},
    });
  });

  it('preserves an optional thought field', () => {
    expect(
      parseResponse('{"thought":"let me check","tool":"x","input":{}}'),
    ).toEqual({
      thought: 'let me check',
      tool: 'x',
      input: {},
    });
  });

  // Regression: GLM-5.2 (thinking model) leakage seen in production logs —
  // leading reasoning fragments and <think> remnants before the tool-call JSON.
  it.each([
    ['bare prefix token "me."', 'me.{ "tool": "datetime_get", "input": {} }'],
    [
      'bare prefix token "ON."',
      'ON.{"tool":"response_user","input":{"message":"hi"}}',
    ],
    [
      'bare prefix token "it."',
      'it.{"tool":"response_user","input":{"message":"hi"}}',
    ],
    [
      'think remnant + fence',
      'ally afternoon.</think>```json\n{ "tool": "response_user", "input": { "message": "Good morning" } }\n```',
    ],
    [
      'think remnant + raw JSON',
      'me.{"tool":"response_user","input":{"message":"Good morning"}}',
    ],
  ])('tolerates %s', (_label, content) => {
    const parsed = parseResponse(content);
    expect(parsed.tool).toMatch(/^(datetime_get|response_user)$/);
    expect(parsed.input).toBeTypeOf('object');
  });

  it('does not let braces inside a <think> block hijack extraction', () => {
    const parsed = parseResponse(
      '<think>maybe {"tool":"wrong"} here</think>{"tool":"response_user","input":{"message":"ok"}}',
    );
    expect(parsed.tool).toBe('response_user');
  });

  it('does not corrupt a string value containing triple backticks', () => {
    const parsed = parseResponse(
      '{"tool":"response_user","input":{"code":"```python"}}',
    );
    expect((parsed.input as { code: string }).code).toBe('```python');
  });

  it('preserves a literal </think> inside a JSON string value', () => {
    const parsed = parseResponse(
      '{"tool":"response_user","input":{"message":"use </think> here"}}',
    );
    expect((parsed.input as { message: string }).message).toBe(
      'use </think> here',
    );
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseResponse('just prose, no json here')).toThrow();
  });

  it('throws when tool/input is missing', () => {
    expect(() => parseResponse('{"foo":"bar"}')).toThrow();
  });
});

// ─── runReactLoop harness ───────────────────────────────────────────────────

/** Canned text the summary-stub LLM returns for any compaction/process-summary fold. */
const SUMMARY_STUB = '<summarized turn>';

/** Build a single ReAct tool-call JSON string the scripted LLM will "reply" with. */
const call = (
  tool: string,
  input: Record<string, unknown> = {},
  thought?: string,
): string => JSON.stringify({ ...(thought ? { thought } : {}), tool, input });

const responseUser = (message: string): string =>
  call(ToolIds.RESPONSE_USER, { message });

interface ToolHandlerResult {
  output?: unknown;
  error?: string;
}
type ToolHandler = (
  toolName: string,
  args: Record<string, unknown>,
) => ToolHandlerResult;

interface ScriptedLlm {
  llm: LlmPort;
  /** One entry per `chatContent` call, snapshotting the messages sent that turn. */
  calls: { messages: LlmMessage[] }[];
}

/** Fake `LlmPort` that replays a scripted list of response strings, one per call. */
function scriptedLlm(responses: string[]): ScriptedLlm {
  let i = 0;
  const calls: { messages: LlmMessage[] }[] = [];
  const chatContent = vi.fn(
    async (
      _modelId: unknown,
      data: { messages?: LlmMessage[] },
    ): Promise<string> => {
      calls.push({ messages: data.messages ?? [] });
      if (i >= responses.length) throw new Error('script exhausted');
      return responses[i++] ?? '';
    },
  );
  const llm = {
    chatContent,
    chat: vi.fn(),
    embed: vi.fn(),
    tts: vi.fn(),
    stt: vi.fn(),
  } as unknown as LlmPort;
  return { llm, calls };
}

/**
 * Deterministic `LlmProvider` registered at `LLM_PORT` so the fold's `Summarizer`
 * (which `container.resolve`s it per fold) never hits a real model and never consumes the
 * loop's scripted responses. Implements `getDefaultModel` because `Summarizer` calls it.
 */
function summaryStubLlm(): LlmPort {
  return {
    chatContent: vi.fn(async () => SUMMARY_STUB),
    chat: vi.fn(),
    embed: vi.fn(),
    tts: vi.fn(),
    stt: vi.fn(),
    getDefaultModel: vi.fn(() => undefined),
  } as unknown as LlmPort;
}

function makeMockCache(): CachePort {
  return {
    resolve: vi.fn(async (_id: string, value: unknown) => value),
    compress: vi.fn(async (_id: string, value: unknown) => value),
    readFile: vi.fn(),
  };
}

/**
 * Fake `executeTool` mirroring the real `ToolCall` event shapes + observation semantics
 * (`tool-call.entity.ts`): yields `tool_call` then `tool_result`/`tool_error`, returns the
 * observation string. A handler that **throws** fails before any event is yielded (models a
 * resolution failure like `ToolNotFoundError`); one returning `{ error }` fails after the
 * `tool_call` (models an execution failure).
 */
function fakeExecuteTool(handler: ToolHandler): AgentRunContext['executeTool'] {
  let counter = 0;
  return (toolName, args) => {
    const callId = `tc_${++counter}`;
    return (async function* generate(): AsyncGenerator<RunEvent, string, void> {
      const res = handler(toolName, args); // may throw → propagates before `tool_call`
      yield { type: 'tool_call', callId, toolName, toolArgs: args };
      if (res.error) {
        yield { type: 'tool_error', callId, toolName, error: res.error };
        return `Error executing tool "${toolName}": ${res.error}`;
      }
      const { output } = res;
      yield { type: 'tool_result', callId, toolName, output };
      return typeof output === 'string' ? output : JSON.stringify(output);
    })();
  };
}

interface BuildCtxOptions {
  responses: string[];
  handler: ToolHandler;
  seed?: LlmMessage[];
  controller?: AbortController;
  hooks?: HookPlan;
}
interface BuiltCtx {
  ctx: AgentRunContext;
  run: AgentRun;
  calls: { messages: LlmMessage[] }[];
}

/** Assemble a real `AgentRunContext` (real `AgentRun`/`RunConfigVO`) minus
 * the LLM (scripted) and the tool path (faked) — enough to drive the real `runReactLoop`. */
function buildCtx(opts: BuildCtxOptions): BuiltCtx {
  const { llm, calls } = scriptedLlm(opts.responses);
  const config = RunConfigVO.of({
    systemPrompt: 'test system prompt',
    tools: [],
    runtimeConfig: {
      model: {},
      loop: { threshold: 0.8, windowSize: 10, keepRecent: 4 },
    },
  });
  const run = new AgentRun('run_1', config);
  const seed = opts.seed ?? [{ role: 'user', content: 'do the task' }];
  const ctx: AgentRunContext = {
    run,
    config,
    runId: run.runId,
    workDir: '/tmp/workdir',
    signal: opts.controller?.signal ?? run.signal,
    llm,
    cache: makeMockCache(),
    messages: ListMonad.of(seed),
    base: seed.length,
    hooks: opts.hooks ?? new HookPlan(resolveAgentHooks()),
    executeTool: fakeExecuteTool(opts.handler),
  };
  return { ctx, run, calls };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const okHandler: ToolHandler = (name, _args) => ({ output: `${name}_result` });

// ─── runReactLoop scenarios ─────────────────────────────────────────────────

describe('runReactLoop', () => {
  beforeEach(() => {
    container.register(LLM_PORT, { useValue: summaryStubLlm() });
    // hooks（CompactionHook/LoopUsageHook）经 ProviderService 派生 contextSize；mock 成大值抑制 mid-loop 压缩。
    container.registerInstance(ProviderService, {
      resolveContextSize: () => 128_000,
      resolveChatModel: () => ({ id: undefined, contextSize: 128_000 }),
    } as unknown as ProviderService);
  });
  afterEach(() => {
    container.clearInstances();
  });

  describe('HappyPath', () => {
    it('runs one tool then response_user to completion without throwing', async () => {
      const { ctx, calls } = buildCtx({
        responses: [call('t1', { a: 1 }), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const types = events.map(e => e.type);

      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      const t1 = events.find(
        e =>
          e.type === 'tool_call' &&
          (e as { toolName: string }).toolName === 't1',
      ) as { toolArgs: Record<string, unknown> };
      expect(t1.toolArgs).toEqual({ a: 1 });
      expect(calls).toHaveLength(2);
    });

    it('a direct response_user (single action) terminates with no process_summary', async () => {
      const { ctx, calls } = buildCtx({
        responses: [responseUser('hi')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const types = events.map(e => e.type);

      expect(types).toEqual(['tool_call', 'tool_result']);
      expect(types).not.toContain('process_summary');
      expect(types).not.toContain('loop_usage');
      expect(calls).toHaveLength(1);
    });

    it('a multi-step run (2 tools then response_user) folds a process_summary', async () => {
      const { ctx, run, calls } = buildCtx({
        responses: [call('t1'), call('t2'), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));

      expect(events.filter(e => e.type === 'tool_call')).toHaveLength(3);
      expect(events.filter(e => e.type === 'loop_usage')).toHaveLength(2);
      expect(run.processSummary).toBe(SUMMARY_STUB);
      expect(calls).toHaveLength(3);
    });
  });

  describe('ToolArgsForwarded', () => {
    it('passes the parsed input through to executeTool', async () => {
      let received: Record<string, unknown> = {};
      const { ctx } = buildCtx({
        responses: [
          call('t1', { key: 'value', count: 42 }),
          responseUser('ok'),
        ],
        handler: (name, args) => {
          if (name === 't1') received = args;
          return { output: 'ok' };
        },
      });

      await collect(runReactLoop(ctx));

      expect(received).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('Thought', () => {
    it('yields a thought event before the matching tool_call', async () => {
      const { ctx } = buildCtx({
        responses: [call('t1', {}, 'let me think'), responseUser('ok')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const firstCallIdx = events.findIndex(e => e.type === 'tool_call');

      expect(events[0]).toMatchObject({
        type: 'thought',
        content: 'let me think',
      });
      expect(events[firstCallIdx - 1].type).toBe('thought');
    });
  });

  describe('ToolErrorFeedback', () => {
    it('yields tool_error and feeds the error back so the model can recover', async () => {
      const { ctx, calls } = buildCtx({
        responses: [call('t1'), responseUser('recovered')],
        handler: name =>
          name === 't1' ? { error: 'crashed' } : { output: 'ok' },
      });

      const events = await collect(runReactLoop(ctx));
      const errEvent = events.find(e => e.type === 'tool_error') as {
        toolName: string;
        error: string;
      };

      expect(errEvent).toBeDefined();
      expect(errEvent.toolName).toBe('t1');
      expect(errEvent.error).toBe('crashed');

      const secondMessages = calls[1].messages;
      expect(
        secondMessages.some(m => m.content.includes('Error executing tool')),
      ).toBe(true);
    });
  });

  describe('ParseErrorRecovery', () => {
    it('appends a parse-error observation and continues instead of throwing', async () => {
      const { ctx, calls } = buildCtx({
        responses: ['this is not json at all', responseUser('ok')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const types = events.map(e => e.type);

      expect(types).toContain('loop_usage');
      expect(types).toContain('tool_call');
      expect(calls).toHaveLength(2);
      expect(
        calls[1].messages.some(m =>
          m.content.includes('Error parsing response'),
        ),
      ).toBe(true);
    });
  });

  describe('UnknownTool', () => {
    it('propagates a resolution failure (current behavior: fail, do not nudge)', async () => {
      const { ctx } = buildCtx({
        responses: [call('ghost')],
        handler: name => {
          if (name === 'ghost') throw new ToolNotFoundError('ghost');
          return { output: 'ok' };
        },
      });

      await expect(collect(runReactLoop(ctx))).rejects.toThrow(
        ToolNotFoundError,
      );
    });
  });

  describe('NoResponse', () => {
    it('throws when the model returns empty content', async () => {
      const { ctx } = buildCtx({
        responses: [''],
        handler: okHandler,
      });

      await expect(collect(runReactLoop(ctx))).rejects.toThrow(
        'No response from model',
      );
    });
  });

  describe('Cancellation', () => {
    it('rejects on the first iteration when the signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const { ctx, calls } = buildCtx({
        responses: [call('t1')],
        handler: okHandler,
        controller,
      });

      await expect(collect(runReactLoop(ctx))).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('rejects on the next iteration after a mid-loop abort', async () => {
      const controller = new AbortController();
      const { ctx, calls } = buildCtx({
        responses: [call('t1'), call('t2'), responseUser('done')],
        handler: name => {
          if (name === 't2') controller.abort('mid');
          return { output: 'ok' };
        },
        controller,
      });

      await expect(collect(runReactLoop(ctx))).rejects.toThrow();
      expect(calls).toHaveLength(2);
    });
  });

  describe('LoopUsage', () => {
    it('emits a loop_usage event after each non-terminal tool iteration', async () => {
      const { ctx } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const loopUsages = events.filter(e => e.type === 'loop_usage') as Array<{
        used: number;
        total: number;
      }>;

      // Only the t1 iteration emits loop_usage; the terminal response_user iteration does not.
      expect(loopUsages).toHaveLength(1);
      expect(typeof loopUsages[0].used).toBe('number');
      expect(loopUsages[0].total).toBe(128_000);
    });
  });

  describe('MessageGrowth', () => {
    it('grows the context fed to the LLM by one action + observation per turn', async () => {
      const { ctx, calls } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
      });

      await collect(runReactLoop(ctx));

      expect(calls).toHaveLength(2);
      const msgs = calls[1].messages;
      expect(msgs[0].role).toBe('user'); // seed
      expect(msgs[1].role).toBe('assistant'); // t1 tool-call JSON
      expect(msgs[1].content).toContain('t1');
      expect(msgs[2].role).toBe('user'); // observation
      expect(msgs[2].content).toContain('Observation:');
    });
  });

  describe('TerminalResponseUser', () => {
    it('ends the loop on response_user with a single LLM call and no loop_usage', async () => {
      const { ctx, calls } = buildCtx({
        responses: [responseUser('final')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx));
      const types = events.map(e => e.type);

      expect(calls).toHaveLength(1);
      expect(types.filter(t => t === 'tool_call')).toHaveLength(1);
      expect(types).not.toContain('loop_usage');
    });
  });

  describe('ProcessSummary', () => {
    it('folds a process summary on multi-step terminal (writes run.processSummary)', async () => {
      const { ctx, run } = buildCtx({
        responses: [call('t1'), call('t2'), responseUser('done')],
        handler: okHandler,
      });

      await collect(runReactLoop(ctx));

      expect(run.processSummary).toBe(SUMMARY_STUB);
    });

    it('does not fold a process summary on a single-action terminal', async () => {
      const { ctx, run } = buildCtx({
        responses: [responseUser('hi')],
        handler: okHandler,
      });

      await collect(runReactLoop(ctx));

      expect(run.processSummary).toBeNull();
    });
  });

  describe('HookPipeline', () => {
    it('在 post-observation 边界 apply hook；终态 response_user 不触发', async () => {
      let spyCalls = 0;
      const spyHook: Hook = {
        id: 'spy',
        phase: 'post-observation',
        apply: async function* (_ctx: AgentRunContext) {
          spyCalls++;
        },
      };
      const { ctx } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
        hooks: new HookPlan([spyHook]),
      });

      await collect(runReactLoop(ctx));

      // t1 迭代 append observation → 触发一次；response_user 终态无 observation → 不触发
      expect(spyCalls).toBe(1);
    });

    it('hook 返回 effect 时 yield hook 事件', async () => {
      const { ctx } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
        hooks: new HookPlan([
          {
            id: 'effect-hook',
            phase: 'post-observation',
            apply: async function* () {
              yield {
                type: 'hook',
                hookId: 'effect-hook',
                summary: 'did something',
                data: { x: 1 },
              };
            },
          },
        ]),
      });

      const events = await collect(runReactLoop(ctx));
      const hookEvents = events.filter(e => e.type === 'hook');
      expect(hookEvents).toHaveLength(1);
      const hookEvent = hookEvents[0] as Extract<RunEvent, { type: 'hook' }>;
      expect(hookEvent.hookId).toBe('effect-hook');
      expect(hookEvent.summary).toBe('did something');
      expect(hookEvent.data).toEqual({ x: 1 });
    });
  });
});
