import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { CompactionHook } from '@/server/modules/agent/application/hooks/compaction-hook';
import { LoopUsageHook } from '@/server/modules/agent/application/hooks/loop-usage-hook';
import { CumulativeBudgetHook } from '@/server/modules/agent/application/hooks/cumulative-budget-hook';
import { StuckHook } from '@/server/modules/agent/application/hooks/stuck-hook';
import { MaxIterationsHook } from '@/server/modules/agent/application/hooks/max-iterations-hook';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { serializeAction } from '@/server/modules/agent/application/service/react-loop';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';

const COMPACTION = { threshold: 0.8, windowSize: 10, keepRecent: 4 };

// fold（libs/compaction）自容器解析 LlmProvider——测试把 mock 注册到 LLM_PORT。
function mockLlm(content = 'RECAP'): LlmProvider {
  return {
    getDefaultModel: () => undefined,
    chatContent: vi.fn(async () => content),
  } as unknown as LlmProvider;
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function makeCtx(opts: {
  seed: LlmMessage[];
  contextSize?: number;
  loopSteps: (string | LlmMessage)[];
  llm?: LlmProvider;
}): { ctx: AgentRunContext; providerService: ProviderService } {
  const llm = opts.llm ?? mockLlm();
  container.register(LLM_PORT, { useValue: llm });
  const contextSize = opts.contextSize ?? 10;
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: { model: {}, loop: COMPACTION },
  });
  const providerService = {
    resolveContextSize: () => contextSize,
  } as unknown as ProviderService;
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
  };
}

describe('agent hook registry（自动识别 + per-run 实例）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('resolveAgentHooks 发现 @agentHook 标记的 hook', () => {
    const hooks = resolveAgentHooks();
    expect(hooks.some(h => h instanceof CompactionHook)).toBe(true);
    expect(hooks.some(h => h instanceof LoopUsageHook)).toBe(true);
    expect(hooks.some(h => h instanceof CumulativeBudgetHook)).toBe(true);
    expect(hooks.some(h => h instanceof StuckHook)).toBe(true);
    expect(hooks.some(h => h instanceof MaxIterationsHook)).toBe(true);
  });

  it('hook 为 per-run 实例：每次 resolve 构造新对象（useClass + 非 singleton）', () => {
    const a = resolveAgentHooks();
    const b = resolveAgentHooks();
    expect(a).not.toBe(b);
    const find = (hs: typeof a, id: string) => hs.find(h => h.id === id)!;
    // CumulativeBudgetHook 持可变 consumed，必须 per-run——两次解析不得同实例
    expect(find(a, 'cumulative-budget')).not.toBe(find(b, 'cumulative-budget'));
    expect(find(a, 'compaction')).not.toBe(find(b, 'compaction'));
  });
});

describe('CompactionHook（自持压缩逻辑，经 ctx.messages 读写缝）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('loop 步骤 ≤ keepRecent 时不动（无事件）', async () => {
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['s0', 's1', 's2', 's3'], // = keepRecent
    });
    const before = ctx.messages.length;
    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('未超阈时不动', async () => {
    const llm = mockLlm();
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 1_000_000,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm,
    });
    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(0);
    expect(llm.chatContent).not.toHaveBeenCalled();
  });

  it('超阈且步骤足够时折叠较早步骤、保留近期 keepRecent', async () => {
    const llm = mockLlm('THE RECAP');
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10, // 阈值 8 token，几条消息即超
      loopSteps: Array.from({ length: 6 }, (_, i) => `observation step ${i}`),
      llm,
    });

    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'compaction' });
    expect(llm.chatContent).toHaveBeenCalledTimes(1); // older=2 < windowSize → 单块

    const msgs = ctx.messages;
    // seed(1) + recap(1) + keepRecent(4) = 6
    expect(msgs.length).toBe(1 + 1 + COMPACTION.keepRecent);
    expect(msgs[1]!.content).toContain('THE RECAP');
    expect(msgs[2]!.content).toContain('observation step 2'); // 保留的近期首条
    expect(ctx.base).toBe(1); // seed 不变
  });

  it('pinned (action, observation) 原子对不折叠：原样驻留 recap 之后', async () => {
    const llm = mockLlm('THE RECAP');
    const pinnedObs = {
      role: 'user' as const,
      content: 'Observation: ## AVAILABLE TOOLS MARKER\n- bash: run commands',
    };
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
        pinnedObs,
        's0',
        's1',
        's2',
        's3',
        's4',
        's5',
      ],
      llm,
    });

    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
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
    const { ctx, providerService } = makeCtx({
      seed: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: action },
      ],
      contextSize: 10,
      loopSteps: [pinnedObs, 's0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('THE RECAP'),
    });

    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(1);
    // [sys, action(seed 原样), recap, pinnedObs, keepRecent(4)] = 8
    expect(ctx.messages.length).toBe(8);
    expect(ctx.messages[1]!.content).toBe(action);
    expect(ctx.messages[2]!.content).toContain('THE RECAP');
    expect(ctx.messages[3]!.content).toBe(pinnedObs.content);
  });

  it('older 区全为 pinned 对 → 无可折叠，整体跳过', async () => {
    const llm = mockLlm('THE RECAP');
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
      llm,
    });
    const before = ctx.messages.length;
    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(0);
    expect(llm.chatContent).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(before);
  });

  it('折叠返回空时回退不动', async () => {
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('   '), // trim 后为空
    });
    const before = ctx.messages.length;
    const events = await collect(
      new CompactionHook(providerService).apply(ctx),
    );
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });
});

describe('LoopUsageHook（post-observation 遥测：yield loop_usage）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('从 ctx.messages + 派生 contextSize 算用量并发 loop_usage', async () => {
    const { ctx, providerService } = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['a', 'b'],
    });
    const events = await collect(new LoopUsageHook(providerService).apply(ctx));
    expect(events).toHaveLength(1);
    const usage = events[0] as Extract<RunEvent, { type: 'loop_usage' }>;
    expect(usage.type).toBe('loop_usage');
    expect(usage.total).toBe(10);
    expect(usage.used).toBeTypeOf('number');
  });
});
