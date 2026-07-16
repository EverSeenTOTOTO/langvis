import { describe, it, expect, vi } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { OffloadHook } from '@/server/modules/agent/application/hooks/offload-hook';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';

// estimateTokens 用内容字符数代理（确定性、可控），不再用盲序列。hook 内对单条 / 全量都生效。
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

/** big body — 长于 MIN_BODY_TO_OFFLOAD(512) 才会被桩。 */
function body(n: number): string {
  return 'x'.repeat(n);
}

function makeCtx(
  messages: LlmMessage[],
  opts: { offload: OffloadConfig | undefined; base?: number },
): AgentRunContext {
  const cache: CachePort = {
    resolve: vi.fn(async (_w: string, v: unknown) => v),
    readFile: vi.fn(),
    offload: vi.fn(async (_w: string, _v: unknown, hint?: string) => ({
      $cached: hint ? `sem__fc_test` : 'fc_test',
      $size: 600,
      $preview: '',
      ...(hint ? { $label: hint } : {}),
    })),
  };
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: { model: {}, offload: opts.offload },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: opts.base ?? 0,
    messages: ListMonad.of<LlmMessage>(messages),
    config,
    cache,
  } as unknown as AgentRunContext;
}

/** contextSize=8192, responseReserve=512 → hardCap=7680（×factor1.1 ⇒ ≤6981 chars 才停桩）。
 *  maxMessageSize=0.4 ⇒ maxMsg=3276（×1.1 ⇒ 单条 ≤2978 chars 才不触发 per-message 桩）。 */
const CFG = (): OffloadConfig => ({
  maxMessageSize: 0.4,
  responseReserve: 512,
});
function makeHook(contextSize: number): OffloadHook {
  const provider = { resolveContextSize: () => contextSize };
  return new OffloadHook(provider as never);
}
function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function userMsg(b: string): LlmMessage {
  return { role: 'user', content: b };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: JSON.stringify({ tool, input }) };
}
function sys(b: string): LlmMessage {
  return { role: 'system', content: b };
}

describe('OffloadHook（pre-LLM 体积护栏：hard-cap + per-message 两条路径）', () => {
  it('fragment 缺失 → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(800))], { offload: undefined });
    const before = ctx.messages.length;
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('总量未逼近 hardCap 且无单条过大 → next，不桩', async () => {
    const ctx = makeCtx([obs(body(800))], { offload: CFG() });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(800)}`);
  });

  it('goal#2：单条正文 > maxMessageSize 即桩（即便总量远低于 hardCap）', async () => {
    // 单条 4000 chars > maxMsg(3276)；总 4012 < hardCap(7680)——仅 per-message 路径触发。
    const ctx = makeCtx(
      [
        assistant('search_flights', { origin: 'PEK', dest: 'SHA' }),
        obs(body(4000)),
      ],
      { offload: CFG() },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    const offloaded = ctx.messages.get(1)!;
    expect(offloaded.content).toContain('[offloaded to file');
    expect(offloaded.content).toContain(
      'cached_read(key="sem__fc_test", offset=0, limit=2000)',
    );
    expect(offloaded.content).toContain('~1 chunks of 2000B'); // mock $size=600 → ceil=1
    expect(offloaded.content).toContain('search_flights'); // hint 含 tool
    expect(offloaded.content).toMatch(/^Observation: /); // 前缀保留
    expect(ctx.messages.get(0)!.content).toContain('search_flights'); // assistant 未桩
  });

  it('goal#1：总量超 hardCap → 最胖优先桩到 hardCap 内', async () => {
    // 10 条 obs 各 800 chars（总 ~8120 > 7680）；单条 800 < maxMsg → 仅 hard-cap 路径。
    const msgs = Array.from({ length: 10 }, () => obs(body(800)));
    const ctx = makeCtx(msgs, { offload: CFG() });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stubbedCount = msgs.filter((_, i) =>
      ctx.messages.get(i)!.content.includes('[offloaded to file'),
    ).length;
    // 两条即可降到 ≤6981（每桩约 −660）；不应桩全部。
    expect(stubbedCount).toBeGreaterThanOrEqual(1);
    expect(stubbedCount).toBeLessThan(10);
  });

  it('最胖优先：多条候选时先桩最大那条', async () => {
    // 3 条 obs：2900 / 2400 / 2400，总 ~7736 > 7680；均 < maxMsg(3276) → 仅 hard-cap。
    // 最大那条(2900)应被桩；它一桩即降到 ~4976 ≤ 6981 → 只桩 1 条且是最大的。
    const big = obs(body(2900));
    const ctx = makeCtx([big, obs(body(2400)), obs(body(2400))], {
      offload: CFG(),
    });
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(0)!.content).toContain('[offloaded to file'); // 最大那条
    expect(ctx.messages.get(1)!.content).not.toContain('[offloaded to file');
    expect(ctx.messages.get(2)!.content).not.toContain('[offloaded to file');
  });

  it('只桩 [base,len)，seed [0,base) 字节不变（保前缀缓存）', async () => {
    // base=1（seed sys @0），loop 区两条 obs 各 4500 chars（总 ~9000 > 7680）。
    const ctx = makeCtx(
      [sys('SEED PREFIX'), obs(body(4500)), obs(body(4500))],
      {
        offload: CFG(),
        base: 1,
      },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    expect(ctx.messages.get(0)!.content).toBe('SEED PREFIX'); // seed 完好
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file');
    expect(ctx.messages.get(2)!.content).toContain('[offloaded to file');
  });

  it('seed 永不桩：[0,base) 即使溢出 hardCap 也不动（大正文应走 Observation 而非 seed）', async () => {
    // 单条超长裸 user（email 正文）在 seed 内(index0, base=1)，>maxMsg 且总超 hardCap。
    // offload 不碰 [0,base) → 无候选 → 不桩（即使会爆窗）。
    const emailBody =
      '/document_archive 归档邮件：标题\n\n发件人：a@b\n发件时间：2026\n\n内容：\n' +
      body(4000);
    const ctx = makeCtx([userMsg(emailBody)], { offload: CFG(), base: 1 });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0); // seed 不桩 → 无桩
    expect(ctx.messages.get(0)!.content).toBe(emailBody); // 原样未动
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });

  it('read-slice 跳过（READ_SLICE_MARK）——断 offload↔cached_read 死环', async () => {
    // 两条 obs：一条是 cached_read 取回的 slice（body > MIN 且含页脚 `[read offset=`），一条普通大 obs。
    // maxMsg 压到 81 → 两者 per-message 都判"过大"应桩；但 slice 含 READ_SLICE_MARK → 跳过，只桩普通那条。
    const slice =
      body(1000) +
      `\n\n[read offset=0 limit=2000; continue with cached_read(key="fc_test", offset=2000, limit=2000)]`;
    const ctx = makeCtx([obs(slice), obs(body(4000))], {
      offload: { maxMessageSize: 0.01, responseReserve: 512 },
    });
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${slice}`); // slice 原样未桩
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file'); // 普通那条被桩
  });

  it('裸 user 消息（无 Observation 前缀）超阈被桩', async () => {
    const ctx = makeCtx([userMsg(body(4000))], { offload: CFG() });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('[offloaded to file');
    expect(stub.startsWith('Observation: ')).toBe(false); // 裸 user 不带前缀
    expect(ctx.cache.offload).toHaveBeenCalled();
  });

  it('per-message：末位单条过大仍桩（位置无关）', async () => {
    // 单条 4000 chars 居末位，>maxMsg → per-message 桩，不论位置。
    const ctx = makeCtx([assistant('search', { q: 'a' }), obs(body(4000))], {
      offload: { maxMessageSize: 0.4, responseReserve: 512 },
    });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file');
  });

  it('已桩化的消息不重复桩（OFFLOADED_MARK 跳过）', async () => {
    const alreadyOffloaded = '[offloaded to file fc_old] size=600B.';
    const ctx = makeCtx(
      [
        assistant('search', { q: 'a' }),
        obs(alreadyOffloaded), // 已桩 → 跳过
        assistant('search', { q: 'b' }),
        obs(body(4000)), // 未桩、>maxMsg → 桩
      ],
      { offload: { maxMessageSize: 0.4, responseReserve: 512 } },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1); // 只桩 index3
    expect(ctx.messages.get(1)!.content).toContain('fc_old');
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file');
  });

  it('小正文不桩（短于 MIN 跳过，即便单条逻辑上超 maxMsg）', async () => {
    // 'small result' 远短于 MIN_BODY_TO_OFFLOAD(512) → 不可桩候选。
    const ctx = makeCtx(
      [assistant('search', { q: 'tiny' }), obs('small result')],
      {
        offload: { maxMessageSize: 0.01, responseReserve: 512 },
      },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(1)!.content).toBe('Observation: small result');
  });

  it('桩固化块数随 $size 增长（大文件多块提示）', async () => {
    const ctx = makeCtx([obs(body(4000))], { offload: CFG() });
    (ctx.cache.offload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      $cached: 'sem__fc_test',
      $size: 45230,
      $preview: '',
      $label: 'pdf-extract',
    });
    await collect(makeHook(8192).apply(ctx));
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('~23 chunks of 2000B'); // ceil(45230/2000)=23
    expect(stub).toContain('offset=0, limit=2000');
  });
});
