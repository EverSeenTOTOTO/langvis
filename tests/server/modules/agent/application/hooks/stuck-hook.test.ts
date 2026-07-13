import { describe, it, expect } from 'vitest';
import { ToolIds } from '@/shared/constants';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
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

/** 每次 apply = 一个 tick；末条消息即本 tick 模型动作。guard 仅 stuckThreshold 生效。 */
function ctxWith(
  lastActionContent: string,
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
    messages: ListMonad.of<LlmMessage>([
      { role: 'assistant', content: lastActionContent },
    ]),
    config,
  } as unknown as AgentRunContext;
}

describe('StuckHook（卡死兜底，阈值取自 guard.stuckThreshold）', () => {
  it('每 tick 新动作 → 永不触发（next、无事件）', async () => {
    const hook = new StuckHook();
    for (const c of [
      '{"tool":"a","input":{}}',
      '{"tool":"b","input":{}}',
      '{"tool":"c","input":{}}',
    ]) {
      const { events, ret } = await collect(hook.apply(ctxWith(c, 3)));
      expect(ret).toBe('next');
      expect(events).toHaveLength(0);
    }
  });

  it('response_user 终态 → 放行（next、无事件、不计入 streak）', async () => {
    const { events, ret } = await collect(
      new StuckHook().apply(
        ctxWith(
          JSON.stringify({
            tool: ToolIds.RESPONSE_USER,
            input: { message: 'done' },
          }),
          3,
        ),
      ),
    );
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });

  it('连续重复到阈值 → hook 事件 + text_chunk + break', async () => {
    const hook = new StuckHook();
    const action = JSON.stringify({ tool: 'query', input: { id: 1 } });
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
    const a = JSON.stringify({ tool: 'a', input: {} });
    const b = JSON.stringify({ tool: 'b', input: {} });
    await collect(hook.apply(ctxWith(a, 3))); // 新 → streak0
    await collect(hook.apply(ctxWith(a, 3))); // streak1
    await collect(hook.apply(ctxWith(b, 3))); // 新 → streak0
    const { events, ret } = await collect(hook.apply(ctxWith(b, 3))); // streak1 → next
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });

  it('解析失败按无动作处理（streak++）', async () => {
    const hook = new StuckHook();
    // threshold=2：tick1 novel '<parse-fail>'(streak0) → tick2 streak1 → tick3 streak2 触发
    await collect(hook.apply(ctxWith('not valid json', 2)));
    await collect(hook.apply(ctxWith('not valid json', 2)));
    const { events, ret } = await collect(
      hook.apply(ctxWith('not valid json', 2)),
    );
    expect(ret).toBe('break');
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'stuck' });
  });
});
