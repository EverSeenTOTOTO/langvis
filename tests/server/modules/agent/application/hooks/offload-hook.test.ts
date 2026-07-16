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

/** big body — 长于 MIN_BODY_TO_OFFLOAD(512) 才会被桩。 */
const BIG_BODY = 'x'.repeat(800);

function makeCtx(
  messages: LlmMessage[],
  opts: {
    offload: OffloadConfig | undefined;
    base?: number;
  },
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
    runtimeConfig: {
      model: {},
      offload: opts.offload,
    },
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

/** contextSize 由 ProviderService.resolveContextSize 派生——hook 构造注入 mock。 */
function makeHook(contextSize: number): OffloadHook {
  const provider = { resolveContextSize: () => contextSize };
  return new OffloadHook(provider as never);
}

function obs(body: string): LlmMessage {
  return { role: 'user', content: `Observation: ${body}` };
}
function userMsg(body: string): LlmMessage {
  return { role: 'user', content: body };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: JSON.stringify({ tool, input }) };
}
/** seed 系统消息（只占位，不会被桩：role 非 user）。 */
function sys(body: string): LlmMessage {
  return { role: 'system', content: body };
}

describe('OffloadHook（pre-LLM 预算化两阶段无损桩化）', () => {
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
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${BIG_BODY}`);
  });

  it('超阈值 → 桩化最老 Observation，桩文本含文件名 + rg/cached_read 提示', async () => {
    // contextSize=8192, threshold 0.8 → 触发线 6553；hardCap=8192-512=7680
    // token 序列：先超(8000)、桩后回到线下(5000)
    tokenSeq.values = [8000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [
        assistant('search_flights', { origin: 'PEK', dest: 'SHA' }), // 0
        obs(BIG_BODY), // 1 — 可桩
      ],
      { offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 } },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'offload' });
    const offloaded = ctx.messages.get(1)!;
    expect(offloaded.content).toContain('[offloaded to file');
    // 固化具体首块 offset/limit（非抽象占位）——根治裸读全文套娃
    expect(offloaded.content).toContain(
      'cached_read(key="sem__fc_test", offset=0, limit=2000)',
    );
    expect(offloaded.content).toContain('~1 chunks of 2000B'); // mock $size=600 → ceil=1
    expect(offloaded.content).toContain('search_flights'); // hint 含 tool
    expect(offloaded.content).toMatch(/^Observation: /); // 前缀保留
    // assistant 消息未被桩
    expect(ctx.messages.get(0)!.content).toContain('search_flights');
  });

  it('桩固化块数随 $size 增长（大文件多块提示）', async () => {
    tokenSeq.values = [9000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx([obs(BIG_BODY)], {
      offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 },
    });
    // 覆盖 mock：模拟 45230B 的大文件（如 PDF 提取）→ ceil(45230/2000)=23 块
    (ctx.cache.offload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      $cached: 'sem__fc_test',
      $size: 45230,
      $preview: '',
      $label: 'pdf-extract',
    });
    await collect(makeHook(8192).apply(ctx));
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('~23 chunks of 2000B');
    expect(stub).toContain('offset=0, limit=2000');
  });

  it('两阶段：阶段 A 只桩 [base,len)，seed [0,base) 字节不变（保前缀缓存）', async () => {
    // base=1（seed 是 sys 在 index0），loop 区 [1,len) 有两条 obs。
    // 持续超阈但可桩区够（两 obs 够桩），应在阶段 A 停下、不回溯 seed。
    tokenSeq.values = [9000, 9000, 5000];
    tokenSeq.n = 0;
    const seed = sys('SEED PREFIX'); // index 0 — base
    const ctx = makeCtx(
      [seed, obs(BIG_BODY), obs(BIG_BODY)], // loop obs @ 1, 2
      {
        offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 },
        base: 1,
      },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    // seed 完好（前缀缓存保护）
    expect(ctx.messages.get(0)!.content).toBe('SEED PREFIX');
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file');
    expect(ctx.messages.get(2)!.content).toContain('[offloaded to file');
  });

  it('两阶段：阶段 A 耗尽仍超 hardCap → 回溯桩 seed（溢出兜底，email 场景）', async () => {
    // 单条超长裸 user 消息（email 正文）在 seed 内（index0, base=1）。
    // loop 区无可桩 → 阶段 A 不动 → 仍超 → 阶段 B 回溯桩 seed。
    tokenSeq.values = [9000, 5000];
    tokenSeq.n = 0;
    const emailBody =
      '/document_archive 归档邮件：标题\n\n发件人：a@b\n发件时间：2026\n\n内容：\n' +
      'x'.repeat(2000);
    const ctx = makeCtx([userMsg(emailBody)], {
      offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 },
      base: 1,
    });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('[offloaded to file');
    expect(stub).toContain('offset=0, limit=2000'); // 固化具体首块
    // HEAD_KEEP 保住 email 指令 + 元信息（skill 触发不丢）
    expect(stub).toContain('/document_archive');
    expect(stub).toContain('发件人');
    // 原 2000+ 字正文已不在消息里
    expect(stub).not.toContain('x'.repeat(1000));
  });

  it('裸 user 消息（无 Observation 前缀）超阈被桩', async () => {
    tokenSeq.values = [9000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx([userMsg(BIG_BODY)], {
      offload: { threshold: 0.8, keepRecent: 4, responseReserve: 512 },
    });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('[offloaded to file');
    // 裸 user 不带 Observation 前缀
    expect(stub.startsWith('Observation: ')).toBe(false);
    // hint 取正文首行（'x'.repeat(800) 整行）规整作 label
    expect(ctx.cache.offload).toHaveBeenCalled();
  });

  it('keepRecent 软偏好：耗尽优选区仍超 → 突破 recent 桩保护段', async () => {
    // 4 条 obs、keepRecent=2。token 持续超阈逼到全桩。
    // oldest-first 先桩 0,1；耗尽仍超 → 推到 2,3（保护段）继续桩。
    tokenSeq.values = [9000, 9000, 9000, 9000, 5000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [obs(BIG_BODY), obs(BIG_BODY), obs(BIG_BODY), obs(BIG_BODY)],
      { offload: { threshold: 0.8, keepRecent: 2, responseReserve: 512 } },
    );
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(0)!.content).toContain('[offloaded to file');
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file');
    // keepRecent 保护段在耗尽优选区仍超时被突破（软偏好）
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file');
  });

  it('已桩化的消息不重复桩（含 [offloaded to file 标记跳过）', async () => {
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
    expect(ctx.messages.get(1)!.content).toContain('fc_old');
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file');
  });

  it('小正文不桩（短于 MIN 跳过，即使超阈且在可桩区）', async () => {
    tokenSeq.values = [8000];
    tokenSeq.n = 0;
    const ctx = makeCtx(
      [assistant('search', { q: 'tiny' }), obs('small result')],
      { offload: { threshold: 0.8, keepRecent: 1, responseReserve: 512 } },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0); // 无可桩 → no event
    expect(ctx.messages.get(1)!.content).toBe('Observation: small result');
  });
});
