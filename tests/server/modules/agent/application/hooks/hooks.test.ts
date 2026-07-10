import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { CompactionHook } from '@/server/modules/agent/application/hooks/compaction-hook';
import { ProcessSummaryHook } from '@/server/modules/agent/application/hooks/process-summary-hook';
import { LoopUsageHook } from '@/server/modules/agent/application/hooks/loop-usage-hook';
import { ListMonad } from '@/server/libs/list';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
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
  loopSteps: string[];
  llm?: LlmProvider;
}): AgentRunContext {
  const llm = opts.llm ?? mockLlm();
  container.register(LLM_PORT, { useValue: llm });
  const contextSize = opts.contextSize ?? 10;
  const config = RuntimeConfigVO.of({
    systemPrompt: '',
    tools: [],
    contextSize,
    runtimeConfig: { model: {}, loop: COMPACTION },
  });
  const seed = opts.seed;
  let messages = ListMonad.of<LlmMessage>(seed);
  for (const step of opts.loopSteps)
    messages = messages.append({ role: 'user', content: step });
  return {
    run: new AgentRun('run_test', config),
    messages,
    base: seed.length,
    config,
    signal: new AbortController().signal,
  } as unknown as AgentRunContext;
}

describe('agent hook registry（自动识别）', () => {
  it('resolveAgentHooks 发现 @agentHook 标记的三个 hook', () => {
    const hooks = resolveAgentHooks();
    expect(hooks.some(h => h instanceof CompactionHook)).toBe(true);
    expect(hooks.some(h => h instanceof ProcessSummaryHook)).toBe(true);
    expect(hooks.some(h => h instanceof LoopUsageHook)).toBe(true);
  });
});

describe('CompactionHook（自持压缩逻辑，经 ctx.messages 读写缝）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('loop 步骤 ≤ keepRecent 时不动（无事件）', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['s0', 's1', 's2', 's3'], // = keepRecent
    });
    const before = ctx.messages.length;
    const events = await collect(new CompactionHook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('未超阈时不动', async () => {
    const llm = mockLlm();
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 1_000_000,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm,
    });
    const events = await collect(new CompactionHook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(llm.chatContent).not.toHaveBeenCalled();
  });

  it('超阈且步骤足够时折叠较早步骤、保留近期 keepRecent', async () => {
    const llm = mockLlm('THE RECAP');
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10, // 阈值 8 token，几条消息即超
      loopSteps: Array.from({ length: 6 }, (_, i) => `observation step ${i}`),
      llm,
    });

    const events = await collect(new CompactionHook().apply(ctx));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'compaction' });
    expect(llm.chatContent).toHaveBeenCalledTimes(1); // older=2 < windowSize → 单块

    const msgs = ctx.messages;
    // seed(1) + recap(1) + keepRecent(4) = 6
    expect(msgs.length).toBe(1 + 1 + COMPACTION.keepRecent);
    expect(msgs.get(1)!.content).toContain('THE RECAP');
    expect(msgs.get(2)!.content).toContain('observation step 2'); // 保留的近期首条
    expect(ctx.base).toBe(1); // seed 不变
  });

  it('折叠返回空时回退不动', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('   '), // trim 后为空
    });
    const before = ctx.messages.length;
    const events = await collect(new CompactionHook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });
});

describe('ProcessSummaryHook（loop-exit 生产者：fold → run.processSummary）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('loop 动作 ≤1 时跳过（trivial turn），不动 run.processSummary', async () => {
    const llm = mockLlm('SHOULD NOT BE CALLED');
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['direct answer'], // 1 个 loop 动作
      llm,
    });
    const events = await collect(new ProcessSummaryHook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.run.processSummary).toBeNull();
    expect(llm.chatContent).not.toHaveBeenCalled();
  });

  it('loop 动作 >1 时折叠并写 run.processSummary', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['thought+action', 'observation', 'final'],
      llm: mockLlm('THE SUMMARY'),
    });
    const events = await collect(new ProcessSummaryHook().apply(ctx));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'hook',
      hookId: 'process-summary',
    });
    expect(ctx.run.processSummary).toBe('THE SUMMARY');
  });

  it('折叠异常时无事件、不写 run.processSummary', async () => {
    const llm = {
      getDefaultModel: () => undefined,
      chatContent: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as LlmProvider;
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['a', 'b'],
      llm,
    });
    const events = await collect(new ProcessSummaryHook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.run.processSummary).toBeNull();
  });
});

describe('LoopUsageHook（post-observation 遥测：yield loop_usage）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('从 ctx.messages + config.contextSize 算用量并发 loop_usage', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['a', 'b'],
    });
    const events = await collect(new LoopUsageHook().apply(ctx));
    expect(events).toHaveLength(1);
    const usage = events[0] as Extract<RunEvent, { type: 'loop_usage' }>;
    expect(usage.type).toBe('loop_usage');
    expect(usage.total).toBe(10);
    expect(usage.used).toBeTypeOf('number');
  });
});
