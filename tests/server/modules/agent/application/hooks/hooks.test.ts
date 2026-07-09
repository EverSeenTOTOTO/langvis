import { describe, it, expect, vi } from 'vitest';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { CompactionHook } from '@/server/modules/agent/application/hooks/compaction-hook';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';

describe('agent hook registry（自动识别）', () => {
  it('resolveAgentHooks 发现 @agentHook 标记的 CompactionHook', () => {
    const hooks = resolveAgentHooks();
    expect(hooks.some(h => h instanceof CompactionHook)).toBe(true);
  });
});

describe('CompactionHook', () => {
  const makeCtx = (compacted: boolean): AgentRunContext =>
    ({
      workingMemory: {
        compact: vi.fn(async () => ({
          compacted,
          usage: { used: 1, total: 10 },
        })),
      },
      signal: new AbortController().signal,
    }) as unknown as AgentRunContext;

  it('apply 委托 workingMemory.compact；压缩生效返回 effect，否则 null', async () => {
    const hook = new CompactionHook();

    const fired = makeCtx(true);
    const effect = await hook.apply(fired);
    expect(fired.workingMemory.compact).toHaveBeenCalledTimes(1);
    expect(effect).not.toBeNull();

    const skipped = makeCtx(false);
    const noEffect = await hook.apply(skipped);
    expect(noEffect).toBeNull();
  });
});
