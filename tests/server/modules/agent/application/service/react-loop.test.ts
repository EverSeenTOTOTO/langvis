import { describe, it, expect, vi } from 'vitest';

import {
  parseResponse,
  serializeAction,
} from '@/server/modules/agent/application/service/react-message';
import { runReactLoop } from '@/server/modules/agent/application/service/react-loop';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { HookPlan, type Hook } from '@/server/modules/agent/domain/model/hook';
import { LoopUsageHook } from '@/server/modules/agent/application/hooks/loop-usage-hook';
import { CumulativeBudgetHook } from '@/server/modules/agent/application/hooks/cumulative-budget-hook';
import { StuckHook } from '@/server/modules/agent/application/hooks/stuck-hook';
import { MaxIterationsHook } from '@/server/modules/agent/application/hooks/max-iterations-hook';
import { TrimStage } from '@/server/modules/agent/application/stages/trim-stage';
import { MicroCompactStage } from '@/server/modules/agent/application/stages/micro-compact-stage';
import { WindowCheckStage } from '@/server/modules/agent/application/stages/window-check-stage';
import { RunFoldStage } from '@/server/modules/agent/application/stages/run-fold-stage';
import { StagePlan } from '@/server/shared/context';
import { ToolHintHook } from '@/server/modules/agent/application/hooks/tool-hint-hook';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { ProviderService } from '@/server/infrastructure/provider.service';
import { ToolIds } from '@/shared/constants';
import type { LlmPort } from '@/server/infrastructure/llm/llm.port';
import type {
  AgentRunContext,
  ToolExecutor,
  ToolRunResult,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import type { RunEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';

// ─── parseResponse ──────────────────────────────────────────────────────────

describe('parseResponse', () => {
  it('parses a clean XML tool call', () => {
    expect(
      parseResponse(
        '<tool_call><tool>datetime_get</tool><input></input></tool_call>',
      ),
    ).toEqual({ thought: undefined, tool: 'datetime_get', input: {} });
  });

  it('parses a fenced ```xml block', () => {
    expect(
      parseResponse(
        '```xml\n<tool_call><tool>datetime_get</tool><input></input></tool_call>\n```',
      ),
    ).toEqual({ thought: undefined, tool: 'datetime_get', input: {} });
  });

  it('preserves an optional thought + params', () => {
    expect(
      parseResponse(
        '<tool_call><thought>let me check</thought><tool>book</tool><input><id>f4</id><pax>Bob</pax></input></tool_call>',
      ),
    ).toEqual({
      thought: 'let me check',
      tool: 'book',
      input: { id: 'f4', pax: 'Bob' },
    });
  });

  it('takes quotes / backslashes in values literally (no escaping needed)', () => {
    const parsed = parseResponse(
      '<tool_call><tool>response_user</tool><input><message>He said "hi" \\d</message></input></tool_call>',
    );
    expect((parsed.input as { message: string }).message).toBe(
      'He said "hi" \\d',
    );
  });

  it('decodes XML entities & CDATA in values', () => {
    const parsed = parseResponse(
      '<tool_call><tool>bash</tool><input><command><![CDATA[a < b && c > d]]></command></input></tool_call>',
    );
    expect((parsed.input as { command: string }).command).toBe(
      'a < b && c > d',
    );
  });

  // Regression: thinking models leak <think>…</think> / leading prose before the tool call.
  it('tolerates <think> remnants and prose before the tool call', () => {
    const parsed = parseResponse(
      'me.<think>reasoning…</think><tool_call><tool>response_user</tool><input><message>hi</message></input></tool_call>',
    );
    expect(parsed.tool).toBe('response_user');
    expect((parsed.input as { message: string }).message).toBe('hi');
  });

  it('throws when there is no tool call', () => {
    expect(() => parseResponse('just prose, no tags here')).toThrow();
  });

  it('throws when tool/input is missing', () => {
    expect(() =>
      parseResponse('<tool_call><tool>x</tool></tool_call>'),
    ).toThrow();
  });
});

// ─── runReactLoop harness ───────────────────────────────────────────────────

/** Canned text the summary-stub LLM returns for any compaction/process-summary fold. */
const SUMMARY_STUB = '<summarized turn>';

/** Build a single ReAct tool-call XML string the scripted LLM will "reply" with. */
const call = (
  tool: string,
  input: Record<string, unknown> = {},
  thought?: string,
): string =>
  serializeAction(thought ? { thought, tool, input } : { tool, input });

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
  /** One entry per `chat` call, snapshotting the messages sent that turn. */
  calls: { messages: LlmMessage[] }[];
}

/** Fake `LlmPort` that replays a scripted list of response strings, one per call（chat 流式单块返回）. */
function scriptedLlm(responses: string[]): ScriptedLlm {
  let i = 0;
  const calls: { messages: LlmMessage[] }[] = [];
  const chat = vi.fn(
    (
      _modelId: unknown,
      data: { messages?: LlmMessage[] },
    ): AsyncGenerator<string, string, void> => {
      calls.push({ messages: data.messages ?? [] });
      if (i >= responses.length) throw new Error('script exhausted');
      const body = responses[i++] ?? '';
      return (async function* () {
        yield body;
        return body;
      })();
    },
  );
  const llm = {
    chat,
    embed: vi.fn(),
    tts: vi.fn(),
    stt: vi.fn(),
  } as unknown as LlmPort;
  return { llm, calls };
}

// Deterministic `LlmProvider` at `LLM_PORT` so the fold's `Summarizer` (resolved per
// fold) never hits a real model nor consumes scripted responses; has `getDefaultModel`.
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

// Fake `ToolExecutor` mirroring `ToolCall` event shapes + observation semantics: yields
// `tool_call` then `tool_result`/`tool_error`; a throwing handler fails before any event.
function fakeExecuteTool(handler: ToolHandler): ToolExecutor {
  let counter = 0;
  return (toolName, args) => {
    const callId = `tc_${++counter}`;
    return (async function* generate(): AsyncGenerator<
      RunEvent,
      ToolRunResult,
      void
    > {
      const res = handler(toolName, args); // may throw → propagates before `tool_call`
      yield { type: 'tool_call', callId, toolName, toolArgs: args };
      if (res.error) {
        yield { type: 'tool_error', callId, toolName, error: res.error };
        return {
          status: 'failed',
          observation: `Error executing tool "${toolName}": ${res.error}`,
        };
      }
      const { output } = res;
      yield { type: 'tool_result', callId, toolName, output };
      return {
        status: 'completed',
        observation:
          typeof output === 'string' ? output : JSON.stringify(output),
      };
    })();
  };
}

interface BuildCtxOptions {
  responses: string[];
  handler: ToolHandler;
  seed?: LlmMessage[];
  controller?: AbortController;
  hooks?: HookPlan;
  stages?: import('@/server/shared/context').StagePlan;
}
interface BuiltCtx {
  ctx: AgentRunContext;
  run: AgentRun;
  calls: { messages: LlmMessage[] }[];
  runTool: ToolExecutor;
}

// hooks 依赖 mock（原容器注册语义）：contextSize 大值抑制 mid-loop 压缩；
// Tool/Skill 空集让 ToolHintHook no-op。直接构造真实 hook 链（依赖经构造注入）。
const providerServiceMock = {
  resolveContextSize: () => 128_000,
  resolveChatModel: () => ({ id: undefined, contextSize: 128_000 }),
} as unknown as ProviderService;
const toolServiceMock = {
  getAllToolInfo: async () => [],
  getCachedToolIds: () => [],
  initialize: async () => {},
} as unknown as ToolService;
const skillServiceMock = {
  getAllSkillInfo: async () => [],
  getCachedSkillIds: () => [],
  initialize: async () => {},
} as unknown as SkillService;
const buildHooks = () => [
  new ToolHintHook(toolServiceMock, skillServiceMock),
  new LoopUsageHook(providerServiceMock),
  new CumulativeBudgetHook(),
  new StuckHook(),
  new MaxIterationsHook(),
];
const buildStages = () => [
  new TrimStage(providerServiceMock),
  new MicroCompactStage(providerServiceMock),
  new WindowCheckStage(providerServiceMock),
  new RunFoldStage(providerServiceMock, summaryStubLlm() as never),
];

// Assemble a real `AgentRunContext` (real `AgentRun`/`RunConfigVO`) with scripted LLM,
// faked tool path — enough to drive the real `runReactLoop`.
function buildCtx(opts: BuildCtxOptions): BuiltCtx {
  const { llm, calls } = scriptedLlm(opts.responses);
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      context: { runFold: { threshold: 0.8, windowSize: 10, keepRecent: 4 } },
    },
  });
  const run = new AgentRun('run_1', config);
  const seed = opts.seed ?? [{ role: 'user', content: 'do the task' }];
  const ctx: AgentRunContext = {
    run,
    config,
    runId: run.runId,
    workDir: '/tmp/workdir',
    conversationId: 'conv_1',
    signal: opts.controller?.signal ?? run.signal,
    llm,
    cache: makeMockCache(),
    auth: noopAuth(),
    messages: seed,
    base: seed.length,
    hooks: opts.hooks ?? new HookPlan(buildHooks()),
    stages: opts.stages ?? new StagePlan(buildStages()),
    interactive: true,
  };
  return { ctx, run, calls, runTool: fakeExecuteTool(opts.handler) };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const okHandler: ToolHandler = (name, _args) => ({ output: `${name}_result` });

// ─── runReactLoop scenarios ─────────────────────────────────────────────────

describe('runReactLoop', () => {
  describe('HappyPath', () => {
    it('runs one tool then response_user to completion without throwing', async () => {
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1', { a: 1 }), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
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
      const { ctx, calls, runTool } = buildCtx({
        responses: [responseUser('hi')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
      const types = events.map(e => e.type);

      // text_chunk 现由 react-loop 流式（splitter）先于 tool_call 发出
      expect(types).toEqual(['text_chunk', 'tool_call', 'tool_result']);
      expect(types).not.toContain('process_summary');
      expect(types).not.toContain('loop_usage');
      expect(calls).toHaveLength(1);
    });

    it('a multi-step run (2 tools then response_user) terminates cleanly', async () => {
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1'), call('t2'), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));

      expect(events.filter(e => e.type === 'tool_call')).toHaveLength(3);
      expect(events.filter(e => e.type === 'loop_usage')).toHaveLength(2);
      expect(calls).toHaveLength(3);
    });
  });

  describe('ToolArgsForwarded', () => {
    it('passes the parsed input through to the tool executor', async () => {
      let received: Record<string, unknown> = {};
      const { ctx, runTool } = buildCtx({
        responses: [
          call('t1', { key: 'value', count: 42 }),
          responseUser('ok'),
        ],
        handler: (name, args) => {
          if (name === 't1') received = args;
          return { output: 'ok' };
        },
      });

      await collect(runReactLoop(ctx, runTool));

      expect(received).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('Thought', () => {
    it('yields a thought event before the matching tool_call', async () => {
      const { ctx, runTool } = buildCtx({
        responses: [call('t1', {}, 'let me think'), responseUser('ok')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
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
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1'), responseUser('recovered')],
        handler: name =>
          name === 't1' ? { error: 'crashed' } : { output: 'ok' },
      });

      const events = await collect(runReactLoop(ctx, runTool));
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
      const { ctx, calls, runTool } = buildCtx({
        responses: ['this is not json at all', responseUser('ok')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
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
      const { ctx, runTool } = buildCtx({
        responses: [call('ghost')],
        handler: name => {
          if (name === 'ghost') throw new ToolNotFoundError('ghost');
          return { output: 'ok' };
        },
      });

      await expect(collect(runReactLoop(ctx, runTool))).rejects.toThrow(
        ToolNotFoundError,
      );
    });
  });

  describe('NoResponse', () => {
    it('throws when the model returns empty content', async () => {
      const { ctx, runTool } = buildCtx({
        responses: [''],
        handler: okHandler,
      });

      await expect(collect(runReactLoop(ctx, runTool))).rejects.toThrow(
        'No response from model',
      );
    });
  });

  describe('Cancellation', () => {
    it('rejects on the first iteration when the signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1')],
        handler: okHandler,
        controller,
      });

      await expect(collect(runReactLoop(ctx, runTool))).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('rejects on the next iteration after a mid-loop abort', async () => {
      const controller = new AbortController();
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1'), call('t2'), responseUser('done')],
        handler: name => {
          if (name === 't2') controller.abort('mid');
          return { output: 'ok' };
        },
        controller,
      });

      await expect(collect(runReactLoop(ctx, runTool))).rejects.toThrow();
      expect(calls).toHaveLength(2);
    });
  });

  describe('LoopUsage', () => {
    it('emits a loop_usage event after each non-terminal tool iteration', async () => {
      const { ctx, runTool } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
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
      const { ctx, calls, runTool } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
      });

      await collect(runReactLoop(ctx, runTool));

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
      const { ctx, calls, runTool } = buildCtx({
        responses: [responseUser('final')],
        handler: okHandler,
      });

      const events = await collect(runReactLoop(ctx, runTool));
      const types = events.map(e => e.type);

      expect(calls).toHaveLength(1);
      expect(types.filter(t => t === 'tool_call')).toHaveLength(1);
      expect(types).not.toContain('loop_usage');
    });

    it('response_user 失败不结束 loop：回灌 error 供模型重试', async () => {
      let failCount = 0;
      const failing: ToolHandler = () => {
        if (failCount++ === 0) {
          return { error: 'data/tts must be object' };
        }
        return { output: 'ok' };
      };
      // 第一次 response_user 失败 → 重试同参数成功。
      const { ctx, runTool } = buildCtx({
        responses: [
          responseUser('final'), // 触发一次(失败)
          responseUser('final'), // 重试(成功)
        ],
        handler: failing,
      });

      const events = await collect(runReactLoop(ctx, runTool));
      const types = events.map(e => e.type);

      expect(types.filter(t => t === 'tool_call')).toHaveLength(2);
      expect(types.filter(t => t === 'tool_error')).toHaveLength(1);
      // 失败回灌成 Observation（未退出）；随后重试成功才退出
      const userObs = ctx.messages.filter(
        m => m.role === 'user' && m.content.includes('Error executing tool'),
      );
      expect(userObs).toHaveLength(1);
    });
  });

  describe('ProcessSummary', () => {
    // process-summary 折叠已迁至 conv 侧 ProcessSummaryTransform（turn-end）；
    // react-loop 不再在 loop-exit 折叠 processSummary。相关断言见 conv transform 测试。
    it.todo('（已迁出）process-summary 不再在 react-loop 内折叠');
  });

  describe('HookPipeline', () => {
    it('在 post-observation 边界 apply hook；终态 response_user 不触发', async () => {
      let spyCalls = 0;
      const spyHook: Hook = {
        id: 'spy',
        phase: 'post-observation',
        apply: async function* (_ctx: AgentRunContext) {
          spyCalls++;
          return;
        },
      };
      const { ctx, runTool } = buildCtx({
        responses: [call('t1'), responseUser('done')],
        handler: okHandler,
        hooks: new HookPlan([spyHook]),
      });

      await collect(runReactLoop(ctx, runTool));

      // t1 迭代 append observation → 触发一次；response_user 终态无 observation → 不触发
      expect(spyCalls).toBe(1);
    });

    it('hook 返回 effect 时 yield hook 事件', async () => {
      const { ctx, runTool } = buildCtx({
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
              return;
            },
          },
        ]),
      });

      const events = await collect(runReactLoop(ctx, runTool));
      const hookEvents = events.filter(e => e.type === 'hook');
      expect(hookEvents).toHaveLength(1);
      const hookEvent = hookEvents[0] as Extract<RunEvent, { type: 'hook' }>;
      expect(hookEvent.hookId).toBe('effect-hook');
      expect(hookEvent.summary).toBe('did something');
      expect(hookEvent.data).toEqual({ x: 1 });
    });
  });
});
