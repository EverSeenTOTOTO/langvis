import { describe, it, expect, vi } from 'vitest';
import { LoopSignal, StopLoop } from '@/server/modules/agent/domain/model/hook';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { WindowCheckStage } from '@/server/modules/agent/application/stages/window-check-stage';

// estimateTokens 用内容字符数代理（与 offload 测试一致，确定性可控）。
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

function body(n: number): string {
  return 'x'.repeat(n);
}
function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function sys(b: string): LlmMessage {
  return { role: 'system', content: b };
}

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

function makeCtx(
  messages: LlmMessage[],
  opts: { base?: number } = {},
): AgentRunContext {
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      guard: {
        maxIterations: 1000,
        maxTokenUsage: 1_000_000,
        stuckThreshold: 5,
      },
    },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: opts.base ?? 0,
    messages,
    config,
    interactive: true,
  } as unknown as AgentRunContext;
}

// responseUser 只 ctx.messages.push 一条 response_user ReAct XML——hook 构造只收 provider。
function makeHook(contextSize: number): WindowCheckStage {
  const provider = { resolveContextSize: () => contextSize };
  return new WindowCheckStage(provider as never);
}

describe('WindowCheckStage（pre-LLM 整体上下文 fail-fast：全量超窗 → 解释 + StopLoop，不截断/不收窄）', () => {
  it('未超窗 → next，不动 messages', async () => {
    const ctx = makeCtx([obs(body(1000))]);
    const { events, ret } = await collect(makeHook(8192).apply(targetOf(ctx)));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.messages[0]!.content).toBe(`Observation: ${body(1000)}`);
  });

  it('全量超窗、最新不在 seed → 解释 + StopLoop（不再截断保留头部）', async () => {
    // 两条 obs 各 5000 chars（总 10000 > 8192 窗口）。fail-fast：整体超窗即停，不截断、不收窄。
    const ctx = makeCtx([obs(body(5000)), obs(body(5000))]);
    const events: any[] = [];
    await expect(
      (async () => {
        for await (const ev of makeHook(8192).apply(targetOf(ctx))) {
          if (ev) events.push(ev);
        }
      })(),
    ).rejects.toBeInstanceOf(StopLoop);
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.summary).toContain('unrecoverable');
    // 消息原样未动（无截断/无收窄指引）。
    expect(ctx.messages[0]!.content).toBe(`Observation: ${body(5000)}`);
    expect(ctx.messages[1]!.content).toBe(`Observation: ${body(5000)}`);
  });

  it('全量超窗、最新落在 seed 内（last<base）→ seed 过大 → 解释 + StopLoop', async () => {
    // seed sys 9000 chars @ index0，base=1 → last=0 < base → seed 自身超窗。
    const ctx = makeCtx([sys(body(9000))], { base: 1 });
    const events: any[] = [];
    await expect(
      (async () => {
        for await (const ev of makeHook(8192).apply(targetOf(ctx))) {
          if (ev) events.push(ev);
        }
      })(),
    ).rejects.toBeInstanceOf(StopLoop);
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.summary).toContain('unrecoverable');
    expect(ctx.messages[0]!.content).toBe(body(9000)); // seed 未动
  });

  it('首 tick seed fit → next，不误判不可恢复', async () => {
    // seed=[sys, obs]，base=2 → last=1 < base，但全量 200 ≤ 8192 → 放行（不因 last<base 就停）。
    const ctx = makeCtx([sys('SEED PREFIX'), obs(body(100))], { base: 2 });
    const { events, ret } = await collect(makeHook(8192).apply(targetOf(ctx)));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.messages[1]!.content).toBe(`Observation: ${body(100)}`); // 未动
  });
});
