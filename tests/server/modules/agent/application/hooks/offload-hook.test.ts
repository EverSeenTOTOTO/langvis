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

/** contextSize=8192，CFG() 取 windowRatio=0.9 → cap=8192×0.9=7372.8；
 *  factor 固定 1.1 → 桩化判断 tokens×1.1 > 7372.8，即 tokens > 6702 才触发（总量口径）。 */
const CFG = (): OffloadConfig => ({ windowRatio: 0.9 });
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

describe('OffloadHook（pre-LLM 无损体积护栏：总量超 contextWindow×windowRatio → 最胖优先桩）', () => {
  it('fragment 缺失 → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(800))], { offload: undefined });
    const before = ctx.messages.length;
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('总量未超 cap → next，不桩', async () => {
    const ctx = makeCtx([obs(body(800))], { offload: CFG() });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(800)}`);
  });

  it('总量超 cap → 最胖优先桩（单条巨消息即触发）', async () => {
    // 单条 8000 chars（total 8012 > 6702）→ 桩它；桩后总 ~292 远低于 cap。
    const ctx = makeCtx(
      [
        assistant('search_flights', { origin: 'PEK', dest: 'SHA' }),
        obs(body(8000)),
      ],
      { offload: CFG() },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    const offloaded = ctx.messages.get(1)!;
    expect(offloaded.content).toContain('[offloaded to file');
    expect(offloaded.content).toContain('rg -n'); // 小文件劝 rg/sed-n/head-n，不再提 cached_read
    expect(offloaded.content).toContain('sed -n');
    expect(offloaded.content).toContain('head -n');
    expect(offloaded.content).not.toContain('cached_read');
    expect(offloaded.content).toContain('~1 chunks of 2000B'); // mock $size=600 → ceil=1
    expect(offloaded.content).toContain('search_flights'); // hint 含 tool
    expect(offloaded.content).toMatch(/^Observation: /); // 前缀保留
    expect(ctx.messages.get(0)!.content).toContain('search_flights'); // assistant 未桩
  });

  it('总量超 cap、多条小消息 → 最胖优先桩到 cap 内', async () => {
    // 10 条 obs 各 800 chars（总 ~8120 > 6702）；单条 800 < cap → 仅靠总量触发。
    const msgs = Array.from({ length: 10 }, () => obs(body(800)));
    const ctx = makeCtx(msgs, { offload: CFG() });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stubbedCount = msgs.filter((_, i) =>
      ctx.messages.get(i)!.content.includes('[offloaded to file'),
    ).length;
    // 每桩约 −520；3 条即可降到 ≤6702；不应桩全部。
    expect(stubbedCount).toBeGreaterThanOrEqual(1);
    expect(stubbedCount).toBeLessThan(10);
  });

  it('最胖优先：多条候选时先桩最大那条', async () => {
    // 3 条 obs：2900 / 2400 / 2400，总 ~7740 > 6702；最大那条(2900)一桩即降到 ~5120 ≤ 6702 → 只桩 1 条且是最大的。
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
    // base=1（seed sys @0），loop 区两条 obs 各 7000 chars（总 ~14024 > 6702，桩一条后剩 ~8304 仍超 → 两条都桩）。
    const ctx = makeCtx(
      [sys('SEED PREFIX'), obs(body(7000)), obs(body(7000))],
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

  it('seed 永不桩：[0,base) 即使会爆窗也不动（大正文应走 Observation 而非 seed）', async () => {
    // 单条超长裸 user（email 正文）在 seed 内(index0, base=1)，总量超 cap。
    // offload 不碰 [0,base) → 无候选 → 不桩（即便会爆窗）。
    const emailBody =
      '/document_archive 归档邮件：标题\n\n发件人：a@b\n发件时间：2026\n\n内容：\n' +
      body(8000);
    const ctx = makeCtx([userMsg(emailBody)], { offload: CFG(), base: 1 });
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0); // seed 不桩 → 无桩
    expect(ctx.messages.get(0)!.content).toBe(emailBody); // 原样未动
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });

  it('bash 纯倾倒已 offload 句柄的 observation 跳过（防 bash cat fc→fc 别名）', async () => {
    // agent cat 一个 offload 句柄文件 → 输出是盘上内容的副本 → 再 offload 只会别名 fc→fc。
    // 动词∈白名单(cat) ∧ 命令含 fc 句柄 → 跳过；旁边一条普通大 bash obs 仍被桩。
    const ctx = makeCtx(
      [
        assistant('bash', { command: 'cat pdf-extract-geely__fc_8a4e9674' }),
        obs(body(4000)),
        assistant('bash', { command: 'echo done' }),
        obs(body(4000)),
      ],
      { offload: CFG() },
    );
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(4000)}`); // cat 句柄 → 未桩
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file'); // 普通 bash → 被桩
  });

  it('bash rg 读 fc 句柄跳过（防 rg-on-fc fc→fc 螺旋）', async () => {
    // rg 对已 offload 句柄再检索同关键词 → 输出≈原句柄的过滤子集，再 offload 必 fc→fc 别名链到 iter 上限 → 跳过。
    // 旁边一条普通大 bash obs 仍被桩。
    const ctx = makeCtx(
      [
        assistant('bash', {
          command: 'rg 收益 pdf-extract-geely__fc_8a4e9674',
        }),
        obs(body(8000)),
        assistant('bash', { command: 'echo done' }),
        obs(body(8000)),
      ],
      { offload: CFG() },
    );
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(8000)}`); // rg 读句柄 → 未桩
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file'); // 普通 bash → 被桩
  });

  it('bash cat 非 offload 文件不跳过：操作数不含 fc 句柄 → 正常桩', async () => {
    // cat 自己的 notes.txt（非 fc 句柄）→ 输出是真内容 → 正常桩。
    const ctx = makeCtx(
      [assistant('bash', { command: 'cat notes.txt' }), obs(body(8000))],
      { offload: CFG() },
    );
    await collect(makeHook(8192).apply(ctx));
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file'); // 非 fc 操作数 → 被桩
  });

  it('裸 user 消息（无 Observation 前缀）超阈被桩', async () => {
    const ctx = makeCtx([userMsg(body(8000))], { offload: CFG() });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('[offloaded to file');
    expect(stub.startsWith('Observation: ')).toBe(false); // 裸 user 不带前缀
    expect(ctx.cache.offload).toHaveBeenCalled();
  });

  it('末位单条过大仍桩（位置无关）', async () => {
    // 单条 8000 chars 居末位，总量超 cap → 桩，不论位置。
    const ctx = makeCtx([assistant('search', { q: 'a' }), obs(body(8000))], {
      offload: CFG(),
    });
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    expect(ctx.messages.get(1)!.content).toContain('[offloaded to file');
  });

  it('bash hint 取命令动词不带参数（防文件名嵌套）', async () => {
    const ctx = makeCtx(
      [
        assistant('bash', { command: 'cat geely-2024-annual-report.pdf' }),
        obs(body(8000)),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1);
    const offloaded = ctx.messages.get(1)!.content;
    expect(offloaded).toContain('(bash-cat)'); // hint = tool + 动词
    expect(offloaded).not.toContain('geely'); // 参数不入文件名 → 不嵌套
  });

  it('已桩化的消息不重复桩（OFFLOADED_MARK 跳过）', async () => {
    const alreadyOffloaded = '[offloaded to file fc_old] size=600B.';
    const ctx = makeCtx(
      [
        assistant('search', { q: 'a' }),
        obs(alreadyOffloaded), // 已桩 → 跳过
        assistant('search', { q: 'b' }),
        obs(body(8000)), // 未桩、总量超 cap → 桩
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook(8192).apply(ctx));
    expect(events).toHaveLength(1); // 只桩 index3
    expect(ctx.messages.get(1)!.content).toContain('fc_old');
    expect(ctx.messages.get(3)!.content).toContain('[offloaded to file');
  });

  it('小正文不桩（短于 MIN 跳过，即便总量逻辑上超 cap）', async () => {
    // 'small result' 远短于 MIN_BODY_TO_OFFLOAD(512) → 不可桩候选；总量也低 → next。
    const ctx = makeCtx(
      [assistant('search', { q: 'tiny' }), obs('small result')],
      {
        offload: CFG(),
      },
    );
    const { events, ret } = await collect(makeHook(8192).apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.get(1)!.content).toBe('Observation: small result');
  });

  it('windowRatio 可调：0.5 → cap=4096，3000 chars 放行、7000 触发', async () => {
    const ok = makeCtx([obs(body(3000))], { offload: { windowRatio: 0.5 } });
    const { ret: r1 } = await collect(makeHook(8192).apply(ok));
    expect(r1).toBe('next'); // 3012 < 4096/1.1=3723 → 不桩
    const over = makeCtx([obs(body(7000))], { offload: { windowRatio: 0.5 } });
    const { events } = await collect(makeHook(8192).apply(over));
    expect(events).toHaveLength(1);
    expect(over.messages.get(0)!.content).toContain('[offloaded to file');
  });

  it('windowRatio 跨 contextSize 自适应：大 ctx 上低 ratio 也能触发', async () => {
    // contextSize=128000, windowRatio=0.01 → cap=1280；threshold 1280/1.1≈1163。2000 chars 触发。
    const over = makeCtx([obs(body(2000))], { offload: { windowRatio: 0.01 } });
    const { events } = await collect(makeHook(128000).apply(over));
    expect(events).toHaveLength(1);
    expect(over.messages.get(0)!.content).toContain('[offloaded to file');
  });

  it('大文件（chunks>LARGE_CHUNK_THRESHOLD）桩只劝 rg、不劝分页', async () => {
    const ctx = makeCtx([obs(body(8000))], { offload: CFG() });
    (ctx.cache.offload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      $cached: 'sem__fc_test',
      $size: 45230,
      $preview: '',
      $label: 'pdf-extract',
    });
    await collect(makeHook(8192).apply(ctx));
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('~23 chunks of 2000B'); // ceil(45230/2000)=23
    expect(stub).toContain('large file');
    expect(stub).toContain('rg -n');
    expect(stub).toContain('do NOT cat or page'); // 大文件禁整读（整读必爆窗）
    expect(stub).not.toContain('cached_read'); // 已移除 cached_read：只劝 bash rg
  });
});
