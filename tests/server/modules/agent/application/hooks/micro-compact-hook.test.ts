import { describe, it, expect } from 'vitest';
import { LoopSignal } from '@/server/modules/agent/domain/model/hook';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { MicroCompactHook } from '@/server/modules/agent/application/hooks/micro-compact-hook';
import { serializeAction } from '@/server/modules/agent/application/service/react-message';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';

async function collect(
  gen: AsyncGenerator<RunEvent, void>,
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

function makeCtx(
  messages: LlmMessage[],
  opts: { offload: OffloadConfig | undefined; base?: number },
): AgentRunContext {
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: { model: {}, offload: opts.offload },
  });
  return {
    runId: 'run_test',
    workDir: '/tmp/workdir',
    base: opts.base ?? 0,
    messages,
    config,
  } as unknown as AgentRunContext;
}

function obs(b: string): LlmMessage {
  return { role: 'user', content: `Observation: ${b}` };
}
function stubObs(fcId: string): LlmMessage {
  return {
    role: 'user',
    content: `Observation: [offloaded to file ${fcId}] size=600B.`,
  };
}
function assistant(tool: string, input: Record<string, unknown>): LlmMessage {
  return { role: 'assistant', content: serializeAction({ tool, input }) };
}

// 测试用小阈值：compactStepThreshold=3、compactAge=2、keepRecent=2。
const CFG = (): OffloadConfig => ({
  compactStepThreshold: 3,
  compactAge: 2,
  keepRecent: 2,
});
function makeHook(): MicroCompactHook {
  return new MicroCompactHook({ resolveContextSize: () => 8192 } as never);
}
// age(i) = i 之后的 assistant 数。

describe('MicroCompactHook（pre-LLM 步数驱动有损丢桩：steps ≥ 阈值后丢 aged 旧 observation 桩）', () => {
  it('fragment 缺失 → next，不动 messages', async () => {
    const ctx = makeCtx([obs('x'), assistant('s', {}), obs('y')], {
      offload: undefined,
    });
    const before = ctx.messages.length;
    const { events, ret } = await collect(makeHook().apply(ctx));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('steps < compactStepThreshold → 不启用', async () => {
    // 仅 2 个 observation < 阈值 3 → 跳过。
    const ctx = makeCtx(
      [stubObs('fc_8a4e9674'), assistant('s', {}), stubObs('fc_8a4e9675')],
      { offload: CFG() },
    );
    const { events, ret } = await collect(makeHook().apply(ctx));
    expect(ret).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(3); // 未丢
  });

  it('启用且 aged stub 出窗 → 有损丢弃（上下文里删除桩指针）', async () => {
    // [stub0, a1, obs2, a3, obs4] steps=3≥3 keepRecent=2 → 处理 i=0,1,2；stub0 age=2≥2、出窗、未回取 → 丢。
    const ctx = makeCtx(
      [
        stubObs('fc_8a4e9674'),
        assistant('s', {}),
        obs('plain'),
        assistant('s', {}),
        obs('tail'),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('hook');
    if (events[0]!.type === 'hook')
      expect(events[0]!.hookId).toBe('micro-compact');
    // stub0 被丢 → 剩 [a1, obs2, a3, obs4]
    expect(ctx.messages.length).toBe(4);
    expect(ctx.messages[0]!.role).toBe('assistant');
    expect(
      ctx.messages.find(m => m.content.includes('fc_8a4e9674')),
    ).toBeUndefined();
  });

  it('age 不够（< compactAge）的桩不丢', async () => {
    // stub0 其后仅 1 assistant → age=1<2 → 不丢。steps=3 满足启用。
    const ctx = makeCtx(
      [
        stubObs('fc_8a4e9674'),
        assistant('s', {}),
        stubObs('fc_8a4e9675'),
        stubObs('fc_8a4e9676'),
      ],
      { offload: { compactStepThreshold: 3, compactAge: 2, keepRecent: 0 } },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(0); // 无 aged stub 可丢
    expect(ctx.messages.length).toBe(4);
  });

  it('近窗口保护：末 keepRecent 条 aged 桩不丢', async () => {
    // [stub0, a1, stub2, a3, stub4] steps=3 keepRecent=2 → 处理 i=0,1,2；stub2/stub4 在末 2 内保护，仅 stub0 出窗。
    // stub0 age=2≥2、出窗 → 丢；stub2 age=1<2 且在窗口内；stub4 在窗口内。
    const ctx = makeCtx(
      [
        stubObs('fc_8a4e9674'),
        assistant('s', {}),
        stubObs('fc_8a4e9675'),
        assistant('s', {}),
        stubObs('fc_8a4e9676'),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(1);
    expect(ctx.messages.length).toBe(4); // 丢 stub0
    expect(
      ctx.messages.find(m => m.content.includes('fc_8a4e9674')),
    ).toBeUndefined();
    expect(
      ctx.messages.find(m => m.content.includes('fc_8a4e9676')),
    ).toBeDefined(); // 近窗口保真
  });

  it('被后续 bash 回取的桩保留（仍在用）', async () => {
    // [stub0(fc_a), a1, stub2(fc_b), a3(bash cat fc_a), obs4] steps=3 keepRecent=2 → 处理 i=0,1,2。
    // stub0 被 a3 回取 → 保留；stub2 age=1<2 → 不丢。两者均不丢 → 无事件。
    const ctx = makeCtx(
      [
        stubObs('fc_8a4e9674'),
        assistant('search', {}),
        stubObs('fc_8a4e9675'),
        assistant('bash', { command: 'cat fc_8a4e9674' }),
        obs('tail'),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(0); // stub0 被回取保留、stub2 age 不够 → 无可丢
    expect(
      ctx.messages.find(m => m.content.includes('fc_8a4e9674')),
    ).toBeDefined();
  });

  it('非桩 observation（完整正文，无 OFFLOADED_MARK）不丢', async () => {
    // obs0 是完整大正文（非桩）→ 不丢（微压缩只丢桩）。
    const ctx = makeCtx(
      [
        obs('x'.repeat(8000)),
        assistant('s', {}),
        obs('plain'),
        assistant('s', {}),
        obs('tail'),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(0); // 无桩可丢
    expect(ctx.messages.length).toBe(5);
  });

  it('assistant 桩不丢（仅丢 observation 桩）', async () => {
    // 一个桩化 assistant（thought 含 OFFLOADED_MARK）→ role 非 user → 跳过。
    const stubbedAssistant: LlmMessage = {
      role: 'assistant',
      content: serializeAction({
        thought: '[offloaded to file fc_8a4e9674] size=600B.',
        tool: 'search',
        input: { _offloaded: 'fc_8a4e9674' },
      }),
    };
    const ctx = makeCtx(
      [
        stubbedAssistant,
        assistant('s', {}),
        obs('plain'),
        assistant('s', {}),
        obs('tail'),
      ],
      { offload: CFG() },
    );
    const { events } = await collect(makeHook().apply(ctx));
    expect(events).toHaveLength(0); // assistant 桩不被丢
    expect(ctx.messages[0]).toBe(stubbedAssistant);
  });

  it('seed [0,base) 不丢', async () => {
    // base=1，seed=stub0；loop 区 obs2/obs4 凑 steps=3 但无 aged 桩 → 不动；seed 桩也不丢。
    const ctx = makeCtx(
      [
        stubObs('fc_8a4e9674'),
        assistant('s', {}),
        obs('plain'),
        assistant('s', {}),
        obs('tail'),
      ],
      { offload: CFG(), base: 1 },
    );
    const { events } = await collect(makeHook().apply(ctx));
    // seed stub0 age=2≥2、出窗，但 base=1 → i 从 1 起，seed@0 不碰 → 保留；loop 区无桩 → 无可丢。
    expect(events).toHaveLength(0);
    expect(
      ctx.messages.find(m => m.content.includes('fc_8a4e9674')),
    ).toBeDefined();
  });
});
