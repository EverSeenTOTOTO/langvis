import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { CompactionHook } from '@/server/modules/agent/application/hooks/compaction-hook';
import { WorkingMemory } from '@/server/modules/agent/domain/model/working-memory';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { LlmMessage } from '@/shared/types/entities';

const COMPACTION = { threshold: 0.8, windowSize: 10, keepRecent: 4 };

// fold（libs/compaction）自容器解析 LlmProvider——测试把 mock 注册到 LLM_PORT。
function mockLlm(content = 'RECAP'): LlmProvider {
  return {
    getDefaultModel: () => undefined,
    chatContent: vi.fn(async () => content),
  } as unknown as LlmProvider;
}

/** 组装真实 WorkingMemory + RuntimeConfigVO 的 ctx，驱动 CompactionHook 自持逻辑（经读写缝）。 */
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
  const workingMemory = new WorkingMemory({
    seed: opts.seed,
    contextSize,
    runtimeConfig: config.runtimeConfig,
  });
  for (const step of opts.loopSteps) workingMemory.append('user', step);
  return {
    workingMemory,
    config,
    signal: new AbortController().signal,
  } as unknown as AgentRunContext;
}

describe('agent hook registry（自动识别）', () => {
  it('resolveAgentHooks 发现 @agentHook 标记的 CompactionHook', () => {
    const hooks = resolveAgentHooks();
    expect(hooks.some(h => h instanceof CompactionHook)).toBe(true);
  });
});

describe('CompactionHook（自持压缩逻辑，经 WorkingMemory 读写缝）', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('loop 步骤 ≤ keepRecent 时不动（返回 null）', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      loopSteps: ['s0', 's1', 's2', 's3'], // = keepRecent
    });
    const before = ctx.workingMemory.messages.length;
    const effect = await new CompactionHook().apply(ctx);
    expect(effect).toBeNull();
    expect(ctx.workingMemory.messages.length).toBe(before);
  });

  it('未超阈时不动', async () => {
    const llm = mockLlm();
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 1_000_000,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm,
    });
    const effect = await new CompactionHook().apply(ctx);
    expect(effect).toBeNull();
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

    const effect = await new CompactionHook().apply(ctx);
    expect(effect).not.toBeNull();
    expect(llm.chatContent).toHaveBeenCalledTimes(1); // older=2 < windowSize → 单块

    const msgs = ctx.workingMemory.messages;
    // seed(1) + recap(1) + keepRecent(4) = 6
    expect(msgs.length).toBe(1 + 1 + COMPACTION.keepRecent);
    expect(msgs.get(1)!.content).toContain('THE RECAP');
    expect(msgs.get(2)!.content).toContain('observation step 2'); // 保留的近期首条
    expect(ctx.workingMemory.baseLength).toBe(1); // seed 不变
  });

  it('折叠返回空时回退不动', async () => {
    const ctx = makeCtx({
      seed: [{ role: 'system', content: 'sys' }],
      contextSize: 10,
      loopSteps: ['s0', 's1', 's2', 's3', 's4', 's5'],
      llm: mockLlm('   '), // trim 后为空
    });
    const before = ctx.workingMemory.messages.length;
    const effect = await new CompactionHook().apply(ctx);
    expect(effect).toBeNull();
    expect(ctx.workingMemory.messages.length).toBe(before);
  });
});
