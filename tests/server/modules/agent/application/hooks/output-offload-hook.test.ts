import { describe, it, expect, vi } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { OutputOffloadHook } from '@/server/modules/agent/application/hooks/output-offload-hook';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';

// estimateTokens 用内容字符数代理（确定性、可控），与 offload-hook.test 同手法。
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

function makeCtx(
  messages: LlmMessage[],
  opts: { offload: OffloadConfig | undefined },
): AgentRunContext {
  const cache: CachePort = {
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
    base: 0,
    messages: ListMonad.of<LlmMessage>(messages),
    config,
    cache,
  } as unknown as AgentRunContext;
}

const hook = (contextSize = 8000): OutputOffloadHook =>
  new OutputOffloadHook({
    resolveContextSize: () => contextSize,
  } as never);
function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function userMsg(b: string): LlmMessage {
  return { role: 'user', content: b };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: JSON.stringify({ tool, input }) };
}

describe('OutputOffloadHook（post-observation 产出即桩：单条超 outputTokenThreshold → 落盘）', () => {
  it('fragment 缺失 → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(800))], { offload: undefined });
    const before = ctx.messages.length;
    const { events, ret } = await collect(hook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(before);
  });

  it('末条 Observation 超阈值 → 桩化（大小口径，与窗口压力无关）', async () => {
    // contextSize=8000×0.2=1600 阈值；8000 chars >> 1600 → 桩（无需 windowRatio）。
    const ctx = makeCtx(
      [assistant('web_fetch', { url: 'https://x' }), obs(body(8000))],
      { offload: {} },
    );
    const { events, ret } = await collect(hook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(1);
    expect(ctx.cache.offload).toHaveBeenCalledTimes(1);
    const offloaded = ctx.messages.get(1)!;
    expect(offloaded.content).toContain('[offloaded to file');
    expect(offloaded.content).toContain('rg -n'); // 小文件策略（mock $size=600 → 1 chunk）
    expect(offloaded.content).toContain('web_fetch'); // hint 含 tool
    expect(offloaded.content).toMatch(/^Observation: /); // 前缀保留
  });

  it('末条低于阈值 → 不桩', async () => {
    const ctx = makeCtx([obs(body(500))], { offload: {} }); // 500 < 1600 阈值
    const { events, ret } = await collect(hook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(500)}`);
  });

  it('outputTokenThreshold 可调：阈值=2000，1800 放行、3000 触发', async () => {
    const ok = makeCtx([obs(body(1800))], {
      offload: { outputTokenThreshold: 2000 },
    });
    expect((await collect(hook().apply(ok))).events).toHaveLength(0);
    const over = makeCtx([obs(body(3000))], {
      offload: { outputTokenThreshold: 2000 },
    });
    expect((await collect(hook().apply(over))).events).toHaveLength(1);
  });

  it('阈值=0 → 关闭（不桩）', async () => {
    const ctx = makeCtx([obs(body(8000))], {
      offload: { outputTokenThreshold: 0 },
    });
    const { events, ret } = await collect(hook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });

  it('只看末条：倒数第二条大、末条小 → 不桩末条（产出即桩仅针对刚产出的）', async () => {
    const ctx = makeCtx([obs(body(8000)), obs(body(300))], { offload: {} });
    const { events } = await collect(hook().apply(ctx));
    expect(events).toHaveLength(0); // 末条 300 < 阈值，不动；不回溯桩 index0
    expect(ctx.messages.get(0)!.content).toBe(`Observation: ${body(8000)}`);
  });

  it('已桩化的末条不重复桩（OFFLOADED_MARK 跳过）', async () => {
    const ctx = makeCtx([obs('[offloaded to file fc_old] size=600B.')], {
      offload: {},
    });
    const { events } = await collect(hook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });

  it('recall 回取（cat 已 offload 句柄）跳过（防 fc→fc 别名）', async () => {
    const ctx = makeCtx(
      [
        assistant('bash', { command: 'cat pdf-extract-geely__fc_8a4e9674' }),
        obs(body(8000)), // 内容是盘上句柄副本 → 再落盘必 fc→fc 别名
      ],
      { offload: {} },
    );
    const { events } = await collect(hook().apply(ctx));
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages.get(1)!.content).toBe(`Observation: ${body(8000)}`);
  });

  it('裸 user（非 Observation）超阈值也桩', async () => {
    const ctx = makeCtx([userMsg(body(8000))], { offload: {} });
    const { events } = await collect(hook().apply(ctx));
    expect(events).toHaveLength(1);
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('[offloaded to file');
    expect(stub.startsWith('Observation: ')).toBe(false); // 裸 user 不带前缀
  });

  it('大文件（chunks>LARGE_CHUNK_THRESHOLD）只劝 rg、不劝分页', async () => {
    const ctx = makeCtx([obs(body(8000))], { offload: {} });
    (ctx.cache.offload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      $cached: 'sem__fc_test',
      $size: 45230, // ceil(45230/2000)=23 > 10 → 大文件
      $preview: '',
      $label: 'pdf-extract',
    });
    await collect(hook().apply(ctx));
    const stub = ctx.messages.get(0)!.content;
    expect(stub).toContain('large file');
    expect(stub).toContain('rg -n');
    expect(stub).toContain('do NOT cat or page');
  });
});
