import { describe, it, expect, vi } from 'vitest';
import { LoopSignal } from '@/server/modules/agent/domain/model/hook';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { TrimStage } from '@/server/modules/agent/application/stages/trim-stage';
import {
  parseResponse,
  serializeAction,
} from '@/server/modules/agent/application/service/react-message';
import type { ContextConfig } from '@/server/shared/context';

// estimateTokens 用内容字符数代理（确定性、可控）。
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: (msgs: { content?: string }[] | undefined) =>
    (msgs ?? []).reduce((s, m) => s + (m?.content?.length ?? 0), 0),
}));

async function collect(
  gen: AsyncGenerator<any, any, any>,
): Promise<{ events: RunEvent[]; ret: LoopSignal | undefined }> {
  const events: RunEvent[] = [];
  let ret: LoopSignal | undefined;
  try {
    for (;;) {
      const r = await gen.next();
      if (r.done) break;
      events.push(r.value);
    }
  } catch (e) {
    if (!(e instanceof LoopSignal)) throw e;
    ret = e;
  }
  return { events, ret };
}

/** body — 长于 CHUNK_SIZE(2000) 才会被桩（桩须明显小于原文）。 */
function body(n: number): string {
  return 'x'.repeat(n);
}

function makeCtx(
  messages: LlmMessage[],
  opts: { context: ContextConfig | undefined; base?: number },
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
    runtimeConfig: { model: {}, context: opts.context },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: opts.base ?? 0,
    messages,
    config,
    cache,
  } as unknown as AgentRunContext;
}

// trimAge=2、keepRecent=4：目标须其后 ≥2 assistant 且出末 4 窗口（index < len-4）。
const CFG = (): ContextConfig => ({ trim: { age: 2, keepRecent: 4 } });
function makeHook(contextSize = 8192): TrimStage {
  return new TrimStage({ resolveContextSize: () => contextSize } as never);
}
function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function userMsg(b: string): LlmMessage {
  return { role: 'user', content: b };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: serializeAction({ tool, input }) };
}
function sys(b: string): LlmMessage {
  return { role: 'system', content: b };
}
// age(i) = i 之后的 assistant 数。
function targetOf(
  ctx: Record<string, any>,
): import('@/server/shared/context').RunTarget {
  return {
    kind: 'run',
    runId: ctx.runId,
    signal: ctx.signal,
    messages: ctx.messages,
    base: ctx.base,
    runtimeConfig: ctx.config?.runtimeConfig ?? ctx.runtimeConfig,
    workDir: ctx.workDir,
    cache: ctx.cache,
  };
}

describe('TrimStage（pre-LLM age 驱动无损桩：aged + non-pinned + 非近窗口 → 落盘 + hint 桩）', () => {
  it('fragment 缺失 → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(8000))], { context: undefined });
    const before = ctx.messages.length;
    const { events, ret } = await collect(makeHook().apply(targetOf(ctx)));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('age 不够（其后 assistant < trimAge）→ 不桩', async () => {
    // obs0 其后仅 1 assistant → age=1 < 2；keepRecent=1 让 obs0 出窗、其余填充不干扰。
    const ctx = makeCtx(
      [obs(body(8000)), assistant('search', { q: 'a' }), obs('ok'), obs('ok')],
      { context: { trim: { age: 2, keepRecent: 1 } } },
    );
    const { events, ret } = await collect(makeHook().apply(targetOf(ctx)));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages[0]!.content).toBe(`Observation: ${body(8000)}`);
  });

  it('aged（其后 ≥ trimAge 个 assistant）且非近窗口 → 桩化落盘（hint 取自配对 action）', async () => {
    // [a0(search), obs1(big), a2, obs3, a4, obs5] len=6 → 处理 i=0,1；obs1 aged 出窗、hint 含 search。
    const ctx = makeCtx(
      [
        assistant('search', { q: 'a' }),
        obs(body(8000)),
        assistant('search', { q: 'b' }),
        obs('ok'),
        assistant('search', { q: 'c' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    expect(ctx.cache.offload).toHaveBeenCalledTimes(1);
    const stubbed = ctx.messages[1]!;
    expect(stubbed.content).toContain('[offloaded to file');
    expect(stubbed.content).toContain('sem__fc_test'); // 带 hint → sem__
    expect(stubbed.content).toContain('rg -n');
    expect(stubbed.content).toContain('search'); // hint 含 tool
    expect(stubbed.content).toMatch(/^Observation: /);
  });

  it('短正文（< CHUNK_SIZE）即便 aged 也不桩', async () => {
    // obs0 age=2≥2、出窗，但 'small result' < 2000 → 不桩。
    const ctx = makeCtx(
      [
        obs('small result'),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages[0]!.content).toBe('Observation: small result');
  });

  it('近窗口保护：末 keepRecent 条 aged 也不桩', async () => {
    // len=5 keepRecent=4 → 仅 index0 出窗；index2/4 在末 4 内保护。三者都够老，只桩 index0。
    const ctx = makeCtx(
      [
        obs(body(8000)),
        assistant('s', { q: 'a' }),
        obs(body(8000)),
        assistant('s', { q: 'b' }),
        obs(body(8000)),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    expect(ctx.messages[0]!.content).toContain('[offloaded to file'); // 窗口外桩
    expect(ctx.messages[2]!.content).toBe(`Observation: ${body(8000)}`); // 末 4 内保真
    expect(ctx.messages[4]!.content).toBe(`Observation: ${body(8000)}`); // 末 4 内保真
  });

  it('seed [0,base) 永不桩（保前缀缓存）', async () => {
    // base=1 seed=sys@0；loop 区 obs1 age=2≥2、出窗 → 桩；seed 不动。
    const ctx = makeCtx(
      [
        sys('SEED PREFIX'),
        obs(body(8000)),
        assistant('s', { q: 'a' }),
        obs('ok'),
        assistant('s', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG(), base: 1 },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(ctx.messages[0]!.content).toBe('SEED PREFIX'); // seed 完好
    expect(events).toHaveLength(1);
    expect(ctx.messages[1]!.content).toContain('[offloaded to file'); // loop 区 aged obs 桩
  });

  it('pinned observation（list_tools detail 产出）aged 也不桩，旁置普通照桩', async () => {
    // [obs0, a1(list_tools bash), obs2(pinned), a3, obs4, a5, obs6] len=7 keepRecent=4 → 处理 i=0,1,2；
    // obs0 普通 aged → 桩；obs2 pinned aged（age=2）→ pin 跳过。
    const ctx = makeCtx(
      [
        obs(body(8000)),
        assistant('list_tools', { tool: 'bash' }),
        obs(body(8000)),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    expect(ctx.messages[0]!.content).toContain('[offloaded to file'); // 普通照桩
    expect(ctx.messages[2]!.content).toBe(`Observation: ${body(8000)}`); // pinned 驻留
    expect(ctx.cache.offload).toHaveBeenCalledTimes(1);
  });

  it('list_tools keywords 简表（无 tool 参数）不 pin → aged 照桩', async () => {
    // obs1 非 pin（list_tools 无 tool 参数）、aged 出窗 → 桩。
    const ctx = makeCtx(
      [
        assistant('list_tools', { keywords: 'search' }),
        obs(body(8000)),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    expect(ctx.messages[1]!.content).toContain('[offloaded to file'); // 非 pin → 桩
  });

  it('recall 回取（cat 已 offload 句柄）aged 也不桩（防 fc→fc 别名）', async () => {
    // [a0(bash cat fc), obs1, a2, obs3, a4, obs5] len=6 keepRecent=4 → 处理 i=0,1；obs1 recall echo → 跳过。
    const ctx = makeCtx(
      [
        assistant('bash', { command: 'cat pdf-extract-geely__fc_8a4e9674' }),
        obs(body(8000)),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(0); // 唯一出窗候选是 recall echo → 无可桩
    expect(ctx.cache.offload).not.toHaveBeenCalled();
    expect(ctx.messages[1]!.content).toBe(`Observation: ${body(8000)}`);
  });

  it('已桩化消息不重复桩（OFFLOADED_MARK 跳过）', async () => {
    // obs0 是已桩、aged、出窗 → OFFLOADED_MARK 跳过。
    const ctx = makeCtx(
      [
        obs('[offloaded to file fc_old] size=600B.'),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });

  it('裸 user 消息（无 Observation 前缀）aged 且长 → 桩', async () => {
    // [user0(big), a1, obs, a2, obs] len=5 keepRecent=4 → 处理 i=0；user0 bare、age=2≥2 → 桩。
    const ctx = makeCtx(
      [
        userMsg(body(8000)),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    const stub = ctx.messages[0]!.content;
    expect(stub).toContain('[offloaded to file');
    expect(stub.startsWith('Observation: ')).toBe(false); // 裸 user 不带前缀
  });
});

describe('TrimStage（assistant 桩：长推理整条 dump，保留 {tool,input:{_offloaded},thought} 结构）', () => {
  function bigAssistant(
    tool: string,
    input: Record<string, unknown>,
  ): LlmMessage {
    return {
      role: 'assistant',
      content: serializeAction({
        thought: 'x'.repeat(8000),
        tool,
        input,
      }),
    };
  }

  it('assistant 长输出 aged → 整条 dump 桩，结构可被 parseResponse 解析', async () => {
    // [bigA0, a1, obs, a2, obs] len=5 keepRecent=4 → 处理 i=0；bigA0 age=2≥2、body≥2000 → 桩。
    const ctx = makeCtx(
      [
        bigAssistant('document_store', { document: { rawContent: 'big' } }),
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(1);
    expect(ctx.cache.offload).toHaveBeenCalledTimes(1);
    const stub = ctx.messages[0]!.content;
    const parsed = parseResponse(stub);
    expect(parsed.tool).toBe('document_store');
    expect(parsed.input).toEqual({ _offloaded: 'sem__fc_test' });
    expect(parsed.thought).toContain('[offloaded to file');
  });

  it('不可解析的 assistant（自由文本）→ 不桩', async () => {
    const ctx = makeCtx(
      [
        { role: 'assistant', content: 'just prose' + body(8000) },
        assistant('search', { q: 'a' }),
        obs('ok'),
        assistant('search', { q: 'b' }),
        obs('ok'),
      ],
      { context: CFG() },
    );
    const { events } = await collect(makeHook().apply(targetOf(ctx)));
    expect(events).toHaveLength(0);
    expect(ctx.cache.offload).not.toHaveBeenCalled();
  });
});
