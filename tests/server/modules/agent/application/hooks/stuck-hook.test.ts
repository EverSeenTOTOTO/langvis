import { describe, it, expect } from 'vitest';
import { ToolIds } from '@/shared/constants';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type {
  AgentRunContext,
  ParsedAction,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { StuckHook } from '@/server/modules/agent/application/hooks/stuck-hook';

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

/** 每次 apply = 一个 tick；本 tick 动作由 loop 权威解析后挂 ctx.pendingAction（hook 直读，不再 re-parse）。guard 仅 stuckThreshold 生效。 */
function ctxWith(
  action: ParsedAction | undefined,
  stuckThreshold: number,
): AgentRunContext {
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      guard: {
        maxIterations: 1000,
        maxTokenUsage: 1_000_000,
        stuckThreshold,
      },
    },
  });
  return {
    runId: 'run_test',
    messages: ListMonad.of<LlmMessage>([]),
    config,
    pendingAction: action,
  } as unknown as AgentRunContext;
}

const act = (
  tool: string,
  input: Record<string, unknown> = {},
): ParsedAction => ({
  tool,
  input,
});

describe('StuckHook（卡死兜底，阈值取自 guard.stuckThreshold）', () => {
  it('每 tick 新动作 → 永不触发（next、无事件）', async () => {
    const hook = new StuckHook();
    for (const a of [act('a'), act('b'), act('c')]) {
      const { events, ret } = await collect(hook.apply(ctxWith(a, 3)));
      expect(ret).toBe('next');
      expect(events).toHaveLength(0);
    }
  });

  it('response_user 终态 → 放行（next、无事件、不计入 streak）', async () => {
    const { events, ret } = await collect(
      new StuckHook().apply(
        ctxWith(act(ToolIds.RESPONSE_USER, { message: 'done' }), 3),
      ),
    );
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });

  it('连续重复到阈值 → hook 事件 + text_chunk + break', async () => {
    const hook = new StuckHook();
    const action = act('query', { id: 1 });
    // threshold=3：tick1 新(streak0) → tick2 streak1 → tick3 streak2 → tick4 streak3 触发
    for (let i = 0; i < 3; i++) {
      const { events, ret } = await collect(hook.apply(ctxWith(action, 3)));
      expect(ret).toBe('next');
      expect(events).toHaveLength(0);
    }
    const { events, ret } = await collect(hook.apply(ctxWith(action, 3)));
    expect(ret).toBe('break');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'stuck' });
    expect(events[1]).toMatchObject({ type: 'text_chunk' });
  });

  it('重复中出现新动作 → streak 清零', async () => {
    const hook = new StuckHook();
    await collect(hook.apply(ctxWith(act('a'), 3))); // 新 → streak0
    await collect(hook.apply(ctxWith(act('a'), 3))); // streak1
    await collect(hook.apply(ctxWith(act('b'), 3))); // 新 → streak0
    const { events, ret } = await collect(hook.apply(ctxWith(act('b'), 3))); // streak1 → next
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });

  it('pendingAction 缺省（loop 未解析/非常规路径）→ 放行 next、不增 streak', async () => {
    const { events, ret } = await collect(
      new StuckHook().apply(ctxWith(undefined, 2)),
    );
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });
});
