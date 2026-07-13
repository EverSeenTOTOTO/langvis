import { describe, it, expect, vi } from 'vitest';
import { ToolIds } from '@/shared/constants';
import { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';
import { BudgetHook } from '@/server/modules/agent/application/hooks/budget-hook';

// 控制 estimateTokens 返回值——BudgetHook 用它累加 consumed。per-test 设值。
const mockTokens = vi.hoisted(() => ({ value: 0 }));
vi.mock('@/server/utils/estimateTokens', () => ({
  estimateTokens: () => mockTokens.value,
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

function ctxWith(messages: LlmMessage[]): AgentRunContext {
  return {
    runId: 'run_test',
    messages: ListMonad.of<LlmMessage>(messages),
  } as unknown as AgentRunContext;
}

describe('BudgetHook（累计 token 预算兜底）', () => {
  it('未超额 → next，无事件、不 append', async () => {
    mockTokens.value = 100;
    const ctx = ctxWith([
      { role: 'assistant', content: '{"tool":"search","input":{"q":"x"}}' },
    ]);
    const before = ctx.messages.length;
    const { events, ret } = await collect(new BudgetHook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });

  it('超额且模型未答复 → yield text_chunk + append 合成 response_user + break', async () => {
    mockTokens.value = 1_200_000;
    const ctx = ctxWith([
      {
        role: 'assistant',
        content: JSON.stringify({ tool: 'search', input: { q: 'x' } }),
      },
    ]);
    const before = ctx.messages.length;
    const { events, ret } = await collect(new BudgetHook().apply(ctx));
    expect(ret).toBe('break');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_chunk' });
    expect(ctx.messages.length).toBe(before + 1);
    const appended = ctx.messages.get(ctx.messages.length - 1)!;
    expect(appended.content).toContain(ToolIds.RESPONSE_USER);
  });

  it('超额但模型已正当 response_user → 放行 next，不覆盖', async () => {
    mockTokens.value = 1_200_000;
    const ctx = ctxWith([
      {
        role: 'assistant',
        content: JSON.stringify({
          tool: ToolIds.RESPONSE_USER,
          input: { message: 'done' },
        }),
      },
    ]);
    const before = ctx.messages.length;
    const { events, ret } = await collect(new BudgetHook().apply(ctx));
    expect(ret).toBe('next');
    expect(events).toHaveLength(0);
    expect(ctx.messages.length).toBe(before);
  });
});
