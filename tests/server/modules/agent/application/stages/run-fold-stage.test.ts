import { describe, it, expect, vi } from 'vitest';
import { RunFoldStage } from '@/server/modules/agent/application/stages/run-fold-stage';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { LlmProvider } from '@/server/infrastructure/llm/llm.provider';
import { ProviderService } from '@/server/infrastructure/provider.service';
import type { LlmMessage } from '@/shared/types/entities';
import { serializeAction } from '@/server/modules/agent/application/service/react-message';

const COMPACTION = { threshold: 0.8, windowSize: 10, keepRecent: 4 };

// estimateTokens 用内容字符数代理（确定性、可控）。
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: (msgs: { content?: string }[] | undefined) =>
    (msgs ?? []).reduce((s, m) => s + (m?.content?.length ?? 0), 0),
}));

function mockLlm(ret = 'SUMMARY'): LlmProvider {
  return { chatContent: vi.fn(async () => ret) } as unknown as LlmProvider;
}

function targetOf(
  ctx: Record<string, any>,
): import('@/server/shared/context').RunTarget {
  return {
    kind: 'run',
    runId: 'run_test',
    signal: ctx.signal,
    messages: ctx.messages,
    base: ctx.base,
    runtimeConfig: ctx.config.runtimeConfig,
    workDir: '/tmp/workdir',
    cache: ctx.cache,
  };
}

function makeCtx(opts: {
  seed: LlmMessage[];
  contextSize?: number;
  loopSteps: (string | LlmMessage)[];
  llm?: LlmProvider;
}): {
  ctx: AgentRunContext;
  providerService: ProviderService;
  llm: LlmProvider;
} {
  const contextSize = opts.contextSize ?? 10;
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: { model: {}, context: { runFold: COMPACTION } },
  });
  const providerService = {
    resolveContextSize: () => contextSize,
  } as unknown as ProviderService;
  const llm = opts.llm ?? mockLlm();
  const seed = opts.seed;
  let messages = seed;
  for (const step of opts.loopSteps)
    messages = [
      ...messages,
      typeof step === 'string'
        ? { role: 'user' as const, content: step }
        : step,
    ];
  return {
    ctx: {
      run: new AgentRun('run_test', config),
      messages,
      base: seed.length,
      config,
      signal: new AbortController().signal,
    } as unknown as AgentRunContext,
    providerService,
    llm,
  };
}

async function collect(gen: AsyncGenerator<any, any, any>) {
  const events: unknown[] = [];
  let r = await gen.next();
  while (!r.done) {
    events.push(r.value);
    r = await gen.next();
  }
  return { events, ret: r.value };
}

describe('RunFoldStage（自持压缩逻辑，经 ctx.messages 读写缝）', () => {
  it('loop 步骤 ≤ keepRecent 时不动（无事件）', async () => {
    const { ctx, providerService, llm } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['s0', 's1', 's2', 's3'], // = keepRecent
    });
    const before = ctx.messages.length;
    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('未超阈时不动', async () => {
    const { ctx, providerService, llm } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 1_000_000,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
    });
    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(0);
    expect(llm.chatContent).not.toHaveBeenCalled();
  });

  it('超阈且步骤足够时折叠较早步骤、保留近期 keepRecent', async () => {
    const { ctx, providerService, llm } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10, // 阈值 8 token，几条消息即超
      loopSteps: Array.from({ length: 6 }, (_, i) => `observation step ${i}`),
      llm: mockLlm('THE RECAP'),
    });

    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'run-fold' });
    expect(llm.chatContent).toHaveBeenCalledTimes(1); // older=2 < windowSize → 单块

    const msgs = ctx.messages;
    // seed(1) + recap(1) + keepRecent(4) = 6
    expect(msgs.length).toBe(1 + 1 + COMPACTION.keepRecent);
    expect(msgs[1]!.content).toContain('THE RECAP');
    expect(msgs[2]!.content).toContain('observation step 2'); // 保留的近期首条
    expect(ctx.base).toBe(1); // seed 不变
  });

  it('pinned (action, observation) 原子对不折叠：原样驻留 recap 之后', async () => {
    const pinnedObs = {
      role: 'user' as const,
      content: 'Observation: ## AVAILABLE TOOLS MARKER\n- bash: run commands',
    };
    const { ctx, providerService, llm } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      llm: mockLlm('THE RECAP'),
      loopSteps: [
        {
          role: 'assistant',
          content: serializeAction({
            tool: 'list_tools',
            input: { tool: 'bash' },
          }),
        },
        pinnedObs,
        's0',
        's1',
        's2',
        's3',
        's4',
        's5',
      ],
    });

    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(1);
    // [sys, recap, 配对 action, pinnedObs, keepRecent(4)] = 8——对保真且相邻（i-1 配对不变式）
    expect(ctx.messages.length).toBe(8);
    expect(ctx.messages[1]!.content).toContain('THE RECAP');
    expect(ctx.messages[2]!.role).toBe('assistant');
    expect(ctx.messages[2]!.content).toContain('<tool>list_tools</tool>');
    expect(ctx.messages[3]!.content).toBe(pinnedObs.content);
    expect(ctx.messages[4]!.content).toContain('s2');
    // fold 输入不含 pinned 对
    const req = vi.mocked(llm.chatContent).mock.calls[0]![1]!;
    expect(req.messages![0]!.content).toContain('[user]: s0');
    expect(req.messages![0]!.content).not.toContain('AVAILABLE TOOLS MARKER');
    expect(req.messages![0]!.content).not.toContain('list_tools');
  });

  it('pinned obs 的配对 action 落在 seed 内 → seed 不动，obs 单条保真', async () => {
    const action = serializeAction({
      tool: 'skill_call',
      input: { skillId: 'gf' },
    });
    const pinnedObs = {
      role: 'user' as const,
      content: 'Observation: SKILL BODY MARKER gf skill instructions',
    };
    const { ctx, providerService, llm } = makeCtx({
      seed: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: action },
      ],
      contextSize: 10,
      loopSteps: [pinnedObs, 's0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('THE RECAP'),
    });

    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(1);
    // [sys, action(seed 原样), recap, pinnedObs, keepRecent(4)] = 8
    expect(ctx.messages.length).toBe(8);
    expect(ctx.messages[1]!.content).toBe(action);
    expect(ctx.messages[2]!.content).toContain('THE RECAP');
    expect(ctx.messages[3]!.content).toBe(pinnedObs.content);
  });

  it('older 区全为 pinned 对 → 无可折叠，整体跳过', async () => {
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      loopSteps: [
        {
          role: 'assistant',
          content: serializeAction({
            tool: 'list_tools',
            input: { tool: 'bash' },
          }),
        },
        { role: 'user', content: 'Observation: TOOLS LIST MARKER' },
        {
          role: 'assistant',
          content: serializeAction({
            tool: 'skill_call',
            input: { skillId: 'gf' },
          }),
        },
        { role: 'user', content: 'Observation: SKILL BODY MARKER' },
        's0',
        's1',
      ],
    });
    const before = ctx.messages.length;
    const { events } = await collect(
      new RunFoldStage(providerService, mockLlm()).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('折叠返回空时回退不动', async () => {
    const { ctx, providerService, llm } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('   '), // trim 后为空
    });
    const before = ctx.messages.length;
    const { events } = await collect(
      new RunFoldStage(providerService, llm).apply(targetOf(ctx)),
    );
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });
});
