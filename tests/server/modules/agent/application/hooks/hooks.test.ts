import { describe, it, expect, vi } from 'vitest';
import { HOOK_TYPES } from '@/server/modules/agent/application/hooks';
import { LoopUsageHook } from '@/server/modules/agent/application/hooks/loop-usage-hook';
import { CumulativeBudgetHook } from '@/server/modules/agent/application/hooks/cumulative-budget-hook';
import { StuckHook } from '@/server/modules/agent/application/hooks/stuck-hook';
import { MaxIterationsHook } from '@/server/modules/agent/application/hooks/max-iterations-hook';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ProviderService } from '@/server/infrastructure/provider.service';
import type { LlmProvider } from '@/server/infrastructure/llm/llm.provider';
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

describe('agent hook 清单（HOOK_TYPES 发现 + 直接构造即新实例）', () => {
  it('HOOK_TYPES 覆盖全部 hook', () => {
    expect(HOOK_TYPES.some(T => T === LoopUsageHook)).toBe(true);
    expect(HOOK_TYPES.some(T => T === CumulativeBudgetHook)).toBe(true);
    expect(HOOK_TYPES.some(T => T === StuckHook)).toBe(true);
    expect(HOOK_TYPES.some(T => T === MaxIterationsHook)).toBe(true);
  });

  it('直接构造即新实例——executor 的 ModuleRef 按次 get 同理（TRANSIENT）', () => {
    const a = new LoopUsageHook({} as never);
    const b = new LoopUsageHook({} as never);
    expect(a).not.toBe(b);
  });
});

describe('LoopUsageHook（post-observation 遥测：yield loop_usage）', () => {
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
