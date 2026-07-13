import { describe, it, expect } from 'vitest';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { RunConfigVO } from '@/server/modules/agent/domain/model/run-config.vo';
import { MaxIterationsHook } from '@/server/modules/agent/application/hooks/max-iterations-hook';

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

/** 每次 apply = 一个 post-observation tick；guard 仅 maxIterations 生效。 */
function ctxWith(maxIterations: number): AgentRunContext {
  const config = RunConfigVO.of({
    tools: [],
    runtimeConfig: {
      model: {},
      guard: { maxIterations, maxTokenUsage: 1_000_000, stuckThreshold: 5 },
    },
  });
  return {
    runId: 'run_test',
    messages: ListMonad.of<LlmMessage>([{ role: 'user', content: 'obs' }]),
    config,
  } as unknown as AgentRunContext;
}

describe('MaxIterationsHook（迭代上限兜底，阈值取自 guard.maxIterations）', () => {
  it('未到上限 → 累计 ticks、next、无事件', async () => {
    const hook = new MaxIterationsHook();
    for (let i = 0; i < 2; i++) {
      const { events, ret } = await collect(hook.apply(ctxWith(3)));
      expect(ret).toBe('next');
      expect(events).toHaveLength(0);
    }
  });

  it('到上限 → hook 事件 + text_chunk + break', async () => {
    const hook = new MaxIterationsHook();
    const cap = 3;
    for (let i = 0; i < cap - 1; i++) await collect(hook.apply(ctxWith(cap)));
    const { events, ret } = await collect(hook.apply(ctxWith(cap)));
    expect(ret).toBe('break');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'hook', hookId: 'max-iterations' });
    expect(events[1]).toMatchObject({ type: 'text_chunk' });
  });

  it('guard 缺失 → 不启用（next）', async () => {
    const config = RunConfigVO.of({ tools: [], runtimeConfig: { model: {} } });
    const ctx = {
      runId: 'run_test',
      messages: ListMonad.of<LlmMessage>([{ role: 'user', content: 'obs' }]),
      config,
    } as unknown as AgentRunContext;
    const { events, ret } = await collect(new MaxIterationsHook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
  });
});
