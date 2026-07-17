import { describe, it, expect, vi } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { QueryBudgetHook } from '@/server/modules/agent/application/hooks/query-budget-hook';

// estimateTokens 用内容字符数代理（与 offload-hook 测试一致，确定性可控）。
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: (msgs: { content?: string }[] | undefined) =>
    (msgs ?? []).reduce((s, m) => s + (m?.content?.length ?? 0), 0),
}));

async function collect(
  gen: AsyncGenerator<RunEvent, string>,
): Promise<{ events: RunEvent[]; ret: string }> {
  const events: RunEvent[] = [];
  let ret = '';
  for (;;) {
    const r = await gen.next();
    if (r.done) {
      ret = r.value;
      break;
    }
    events.push(r.value);
  }
  return { events, ret };
}

function body(n: number): string {
  return 'x'.repeat(n);
}
function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function sys(b: string): LlmMessage {
  return { role: 'system', content: b };
}

function makeCtx(
  messages: LlmMessage[],
  opts: { maxQuerySize?: number; maxQueryTokens?: number; base?: number },
): AgentRunContext {
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      guard: {
        maxIterations: 1000,
        maxTokenUsage: 1_000_000,
        stuckThreshold: 5,
        // per-latest 单条 cap 配置在 guard（与 offload 无关）。测试自给默认值（对齐 fragment）。
        maxQuerySize: opts.maxQuerySize ?? 0.4,
        maxQueryTokens: opts.maxQueryTokens ?? 10_000,
      },
    },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: opts.base ?? 0,
    messages: ListMonad.of<LlmMessage>(messages),
    config,
  } as unknown as AgentRunContext;
}

// contextSize=8192, maxQuerySize 默认 0.4 → budget=min(10k,3276)=3276；prefix=0 → remaining=8192 → cap=min(3276,8192)=3276。
function makeHook(contextSize: number): QueryBudgetHook {
  const provider = { resolveContextSize: () => contextSize };
  return new QueryBudgetHook(provider as never);
}

describe('QueryBudgetHook（pre-LLM 超限兜底：latest > min(budget, remaining) → drop 最新一条 + continue）', () => {
  it('最新一条未超 cap → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(1000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(1000)}`);
  });

  it('超 cap：只 drop 最新一条 + continue', async () => {
    // 最新一条 8000 chars（prefix=0 → remaining=8192 → cap=min(3276,8192)=3276；8000 > 3276）。
    const ctx = makeCtx([obs(body(8000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('continue');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.hookId).toBe('query-budget');
    const replaced = ctx.messages.get(0)!.content;
    expect(replaced).toContain('[query over budget');
    expect(replaced.length).toBeLessThan(500); // 超限桩本身很短，不再触窗
    expect(replaced).toMatch(/^Observation: /); // 保留前缀
    expect(replaced).toContain('smaller scope');
  });

  it('只动最新一条：多条时次新条不变', async () => {
    // 两条：旧 2000、最新 8000。prefix=2012 → remaining=6180 → cap=min(3276,6180)=3276；8000 > 3276 → drop 最新，旧条不变。
    const ctx = makeCtx([obs(body(2000)), obs(body(8000))], {});
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('continue');
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(2000)}`); // 次新不变
    expect(ctx.messages.get(1)!.content).toContain('[query over budget'); // 最新被 drop
  });

  it('大 prefix + 中等 latest 实际装得下 → 不 drop（旧 total 口径会误杀）', async () => {
    // 旧 6500、最新 1000。prefix=6512 → remaining=1680 → cap=min(3276,1680)=1680；latest 1012 ≤ 1680 → next。
    // per-latest 口径看 latest 是否塞得进余量 → 放行（总 7524 < 8192 实际装得下，latest 不爆窗）。
    const ctx = makeCtx([obs(body(6500)), obs(body(1000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(1000)}`); // 未动
  });

  it('大 prefix + latest 超余量 → drop（正是大 seed 爆窗的兜底）', async () => {
    // 旧 6500、最新 3000。prefix=6512 → remaining=1680 → cap=1680；latest 3012 > 1680 → drop。
    // 总 9524 > 8192 实际爆窗；per-latest 口径：latest 3012 > remaining 1680 → drop。
    const ctx = makeCtx([obs(body(6500)), obs(body(3000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('continue');
    expect(events).toHaveLength(1);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(6500)}`); // prefix 不动
    expect(ctx.messages.get(1)!.content).toContain('[query over budget'); // 最新被 drop
  });

  it('prefix 自身填满窗口 → 不可恢复 break（避免 continue 死循环）', async () => {
    // 旧 8200（≥ 窗口 8192）、最新 10。prefix=8212 → remaining=-20 ≤ 0 → break（drop 最新无济于事，prefix 自身爆窗）。
    const ctx = makeCtx([obs(body(8200)), obs(body(10))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('break');
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.summary).toContain('prefix fills window');
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(8200)}`); // 未动
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(10)}`); // 未动
  });

  it('maxQuerySize 可调：0.5 → budget=4096，4000 chars 放行、5000 触发', async () => {
    const ok = makeCtx([obs(body(4000))], { maxQuerySize: 0.5 });
    const { ret: r1 } = await collect(makeHook(8192).apply(ok));
    expect(r1).toBe('next');
    const over = makeCtx([obs(body(5000))], { maxQuerySize: 0.5 });
    const { ret: r2 } = await collect(makeHook(8192).apply(over));
    expect(r2).toBe('continue');
  });

  it('offload 跳过的 read-slice 本 hook 也 drop（正是 offload 盲区）', async () => {
    // 8000 chars 的 cached_read slice（含页脚）；offload 会跳过它，本 hook drop 最新一条。
    const slice =
      body(7900) +
      `\n\n[read offset=0 limit=10000; continue with cached_read(key="fc_x", offset=10000, limit=10000)]`;
    const ctx = makeCtx([obs(slice)], {});
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('continue');
    expect(ctx.messages.get(0)!.content).toContain('[query over budget');
  });

  it('首 tick seed（system+userGoal, base=末位）fit → next，不误判不可恢复', async () => {
    // seed = [sys, obs]，base=2 → last=1 < base。最新一条(obs 100)塞得进余量 → 须先放行，
    // 不能因 last<base 就 break（否则首 tick 直接 fail，run 0 iter 收尾）。
    const ctx = makeCtx([sys('SEED PREFIX'), obs(body(100))], { base: 2 });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(100)}`); // 未动
  });

  it('base（[0,base) seed）不动：最新落在 seed 内 → break', async () => {
    // seed sys 8000 chars @ index0，base=1 → last=0 < base → 无可 drop → break。
    const ctx = makeCtx([sys(body(8000))], { base: 1 });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('break');
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.summary).toContain('unrecoverable');
    expect(ctx.messages.get(0)!.content).toBe(body(8000)); // seed 未动
  });

  it('大 context 上 10k 绝对值生效：min(10k, 128k×0.4)=10k', async () => {
    // contextSize=128000, ratio 0.4 → 51200；budget=min(10000, …)=10000。
    // 9000 chars 放行（≤10000）；11000 触发（>10000），即便远未到 128k 窗口。
    const ok = makeCtx([obs(body(9000))], {});
    const { ret: r1 } = await collect(makeHook(128000).apply(ok));
    expect(r1).toBe('next');
    const over = makeCtx([obs(body(11000))], {});
    const { ret: r2 } = await collect(makeHook(128000).apply(over));
    expect(r2).toBe('continue');
    expect(over.messages.get(0)!.content).toContain('[query over budget');
  });
});
