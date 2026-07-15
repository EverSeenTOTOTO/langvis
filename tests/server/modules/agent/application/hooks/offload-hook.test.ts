import { describe, it, expect, vi } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { OffloadHook } from '@/server/modules/agent/application/hooks/offload-hook';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';

// 控制 estimateTokens：每个 tick 返回递减值（桩化后变小）。per-test 设序列。
const tokenSeq = vi.hoisted(() => ({ values: [] as number[], n: 0 }));
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: () => {
    const v = tokenSeq.values[tokenSeq.n] ?? tokenSeq.values.at(-1) ?? 0;
    tokenSeq.n++;
    return v;
  },
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

/** big body — 长于 MIN_BODY_TO_OFFLOAD(256) 才会被桩。 */
const BIG_BODY = 'x'.repeat(600);

function makeCtx(
  messages: LlmMessage[],
  opts: { offload: OffloadConfig | undefined },
): AgentRunContext {
  const cache: CachePort = {
    resolve: vi.fn(async (_w: string, v: unknown) => v),
    compress: vi.fn(async (_w: string, v: unknown) => v),
    readFile: vi.fn(),
    offload: vi.fn(async (_w: string, _v: unknown, hint?: string) => ({
      $cached: hint ? 'sem__fc_test' : 'fc_test',
      $size: 600,
      $preview: '',
      ...(hint ? { $label: hint } : {}),
    })),
  };
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      offload: opts.offload,
    },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: 0,
    messages: ListMonad.of<LlmMessage>(messages),
    config,
    cache,
  } as unknown as AgentRunContext;
}

/** contextSize 由 ProviderService.resolveContextSize 派生——hook 构造注入 mock。 */
function makeHook(contextSize: number): OffloadHook {
  const provider = { resolveContextSize: () => contextSize };
  return new OffloadHook(provider as never);
}

function obs(body: string): LlmMessage {
  return { role: 'user', content: `Observation: ${body}` };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: JSON.stringify({ tool, input }) };
}

describe('OffloadHook（预算化无损 LRU 桩化）', () => {
  it('offload fragment 缺失 → next，不动 messages', async () => {
    tokenSeq.values = [10_000];
    tokenSeq.n = 0;
    const ctx = makeCtx([obs(BIG_BODY)], { offload: undefined });
    const before = ctx.messages.length;
    const hook = makeHook(8192);
    const { events, ret } = await collect(hook.apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('未超阈值 → next，不桩', async () => {
    tokenSeq.values = [5000];
    tokenSeq.n = 0;
    const ctx = makeCtx([obs(BIG_BODY)], {
      offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 },
    });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    const first = ctx.messages.get(0)!;
    expect(first.content).toBe(`Observation: ${BIG_BODY}`);
  });

  it('超阈值 → 桩化最老 Observation，桩文本含文件名 + rg/cached_read 提示', async () => {
    // contextSize=8192, threshold 0.8 → 触发线 6553；hardCap=8192-512=7680
    // 3 条消息、keepRecent=1 → upperBound=2，obs(index1) 可桩；index2(a) 保护。
    // token 序列：先超(8000)、桩后回到线下(5000)
    tokenSeq.values = [8000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [
        assistant('search_flights', { origin: 'PEK', dest: 'SHA' }), // 0
        obs(BIG_BODY), // 1 — 可桩
        assistant('book', { id: 'f1' }), // 2 — keepRecent 保护
      ],
      { offload: { threshold: 0.8, keepRecent: 1, responseReserve: 512 } },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'offload' });
    const offloaded = ctx.messages.get(1)!;
    expect(offloaded.content).toContain('[offloaded to file');
    expect(offloaded.content).toContain('rg "<pattern>"');
    expect(offloaded.content).toContain('cached_read(key=');
    expect(offloaded.content).toContain('search_flights'); // hint 含 tool
    // assistant 消息未被桩
    expect(ctx.messages.get(0)!.content).toContain('search_flights');
    expect(ctx.messages.get(2)!.content).toContain('"id":"f1"');
  });

  it('LRU：最近 keepRecent 条消息不被桩（即使持续超阈）', async () => {
    // base=0, keepRecent=2 → 可桩区 [0, length-2)=[0,4)：index1,3 可桩；
    // index4(assistant)跳过、index5(obs)在保护段 ≥ upperBound=4 不桩。
    // token 持续超阈，逼 hook 把可桩的全桩完后在保护边界停下。
    tokenSeq.values = [8000, 8000, 8000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [
        assistant('search', { q: 'old' }), // 0
        obs(BIG_BODY), // 1 — 可桩
        assistant('search', { q: 'mid' }), // 2
        obs(BIG_BODY), // 3 — 可桩
        assistant('search', { q: 'new' }), // 4 — keepRecent 保护（≥upperBound）
        obs(BIG_BODY), // 5 — keepRecent 保护（≥upperBound）
      ],
      { offload: { threshold: 0.8, keepRecent: 2, responseReserve: 512 } },
    );
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file'); // 老 obs 被桩
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file'); // 中 obs 被桩
    expect(ctx.messages.get(5)!.content).toBe(`Observation: ${BIG_BODY}`); // 保护段未桩
    expect(ctx.messages.get(4)!.content).toContain('"q":"new"'); // assistant 未被碰
  });

  it('已桩化的 Observation 不重复桩（含 [offloaded to file 标记跳过）', async () => {
    tokenSeq.values = [8000, 8000, 5000];
    tokenSeq.n = 0;
    const alreadyOffloaded = '[offloaded to file fc_old] size=600B.';
    const ctx = makeCtx(
      [
        assistant('search', { q: 'a' }),
        obs(alreadyOffloaded), // 已桩 → 跳过
        assistant('search', { q: 'b' }),
        obs(BIG_BODY), // 未桩 → 桩
      ],
      { offload: { threshold: 0.8, keepRecent: 0, responseReserve: 512 } },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1); // 只桩了 index3 一条
    // index 1 仍是原已桩内容（未被再处理）
    expect(ctx.messages.get(1)!.content).toContain('fc_old');
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file');
  });

  it('小正文不桩（短于阈值跳过，即使超阈且在可桩区）', async () => {
    tokenSeq.values = [8000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [
        assistant('search', { q: 'tiny' }),
        obs('small result'), // 在可桩区(index1)但正文太短 → 跳过
        assistant('book', { id: 'f1' }),
      ],
      { offload: { threshold: 0.8, keepRecent: 1, responseReserve: 512 } },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0); // 无可桩 → no event
    expect(ctx.messages.get(1)!.content).toBe('Observation: small result');
  });
});
