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
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: JSON.stringify({ tool, input }) };
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

describe('QueryBudgetHook（pre-LLM 超限兜底：latest > min(budget, remaining) → 截断保留头部 + 收窄指引 + next）', () => {
  it('最新一条未超 cap → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(1000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(1000)}`);
  });

  it('超 cap：截断保留头部 + 收窄指引 + next（放行 LLM 让 agent 收窄，非销毁）', async () => {
    // 最新一条 8000 chars（prefix=0 → remaining=8192 → cap=min(3276,8192)=3276；8000 > 3276）。
    const ctx = makeCtx([obs(body(8000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.hookId).toBe('query-budget');
    const replaced = ctx.messages.get(0)!.content;
    expect(replaced).toContain('[query over budget');
    expect(replaced).toContain('truncated head');
    expect(replaced).toContain('Narrow the originating call'); // 非 recall → 收窄发起方
    expect(replaced).toMatch(/^Observation: x/); // 保留真实头部数据
    expect(replaced.length).toBeLessThan(8000); // 截断后远小于原文
  });

  it('只动最新一条：多条时次新条不变', async () => {
    // 两条：旧 2000、最新 8000。prefix=2012 → remaining=6180 → cap=min(3276,6180)=3276；8000 > 3276 → 截断最新，旧条不变。
    const ctx = makeCtx([obs(body(2000)), obs(body(8000))], {});
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(2000)}`); // 次新不变
    expect(ctx.messages.get(1)!.content).toContain('[query over budget'); // 最新被截断
  });

  it('大 prefix + 中等 latest 实际装得下 → 不截断（旧 total 口径会误杀）', async () => {
    // 旧 6500、最新 1000。prefix=6512 → remaining=1680 → cap=min(3276,1680)=1680；latest 1012 ≤ 1680 → next。
    const ctx = makeCtx([obs(body(6500)), obs(body(1000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(1000)}`); // 未动
  });

  it('大 prefix + latest 超余量 → 截断（正是大 seed 爆窗的兜底）', async () => {
    // 旧 6500、最新 3000。prefix=6512 → remaining=1680 → cap=1680；latest 3012 > 1680 → 截断。
    const ctx = makeCtx([obs(body(6500)), obs(body(3000))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(6500)}`); // prefix 不动
    expect(ctx.messages.get(1)!.content).toContain('[query over budget'); // 最新被截断
  });

  it('prefix 自身填满窗口 → 不可恢复 break（避免死循环）', async () => {
    // 旧 8200（≥ 窗口 8192）、最新 10。prefix=8212 → remaining=-20 ≤ 0 → break（截断最新无济于事，prefix 自身爆窗）。
    const ctx = makeCtx([obs(body(8200)), obs(body(10))], {});
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('break');
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.summary).toContain('prefix fills window');
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(8200)}`); // 未动
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(10)}`); // 未动
  });

  it('maxQuerySize 可调：0.5 → budget=4096，4000 chars 放行、5000 触发截断', async () => {
    const ok = makeCtx([obs(body(4000))], { maxQuerySize: 0.5 });
    const { ret: r1 } = await collect(makeHook(8192).apply(ok));
    expect(r1).toBe('next');
    const over = makeCtx([obs(body(5000))], { maxQuerySize: 0.5 });
    const { ret: r2 } = await collect(makeHook(8192).apply(over));
    expect(r2).toBe('next');
  });

  it('recall（cached_read slice）超 cap：截断头部 + 指向盘上原句柄的 bash 收窄指引（非销毁）', async () => {
    // offload 跳过 cached_read 回取（防 fc→fc 别名）；本 hook 接住：截断 + 指 rg/sed-n 收窄（不再提 cached_read）。
    const slice =
      body(7900) +
      `\n\n[read offset=0 limit=10000; continue with cached_read(key="fc_recall", offset=10000, limit=10000)]`;
    const ctx = makeCtx(
      [
        assistant('cached_read', { key: 'fc_recall', offset: 0, limit: 10000 }),
        obs(slice),
      ],
      {},
    );
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    const replaced = ctx.messages.get(1)!.content;
    expect(replaced).toContain('[query over budget');
    expect(replaced).toContain('truncated head');
    expect(replaced).toContain('fc_recall'); // 指向盘上原句柄
    expect(replaced).toContain('rg -n');
    expect(replaced).toContain('sed -n');
    expect(replaced).not.toContain('cached_read'); // 已移除 cached_read：只劝 bash
    expect(replaced).toMatch(/^Observation: x/); // 保留头部
  });

  it('recall（bash cat 整个 offload 文件）超 cap：截断头部 + 劝 rg/sed-n，勿再整读', async () => {
    const ctx = makeCtx(
      [
        assistant('bash', { command: 'cat pdf-extract-geely__fc_8a4e9674' }),
        obs(body(7900)),
      ],
      {},
    );
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    const replaced = ctx.messages.get(1)!.content;
    expect(replaced).toContain('pdf-extract-geely__fc_8a4e9674'); // 指向原句柄整文件名
    expect(replaced).toContain('do NOT re-read the whole file');
    expect(replaced).toMatch(/^Observation: x/);
  });

  it('recall（bash rg 读 offload 句柄）超 cap：截断头部 + 劝收窄，勿再同检索', async () => {
    // rg-on-fc 被 offload 跳过后本 hook 接住：截断 + 指更窄 pattern / sed-n，勿再跑同样宽检索（防 rg fc→fc 螺旋）。
    const ctx = makeCtx(
      [
        assistant('bash', {
          command: 'rg 收益 pdf-extract-geely__fc_8a4e9674 -C3',
        }),
        obs(body(7900)),
      ],
      {},
    );
    const { ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    const replaced = ctx.messages.get(1)!.content;
    expect(replaced).toContain('pdf-extract-geely__fc_8a4e9674');
    expect(replaced).toContain('rg -n');
    expect(replaced).toContain('re-run the same broad search');
    expect(replaced).toMatch(/^Observation: x/);
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
    // seed sys 8000 chars @ index0，base=1 → last=0 < base → 无可截断 → break。
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
    // 9000 chars 放行（≤10000）；11000 触发截断（>10000），即便远未到 128k 窗口。
    const ok = makeCtx([obs(body(9000))], {});
    const { ret: r1 } = await collect(makeHook(128000).apply(ok));
    expect(r1).toBe('next');
    const over = makeCtx([obs(body(11000))], {});
    const { ret: r2 } = await collect(makeHook(128000).apply(over));
    expect(r2).toBe('next');
    expect(over.messages.get(0)!.content).toContain('[query over budget');
  });
});
