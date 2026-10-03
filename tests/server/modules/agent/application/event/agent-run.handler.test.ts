import { describe, it, expect, vi } from 'vitest';
import { AgentRunHandler } from '@/server/modules/agent/application/event/agent-run.handler';
import { TurnInitiated } from '@/server/modules/conversation/contracts';
import { RunCompleted } from '@/server/modules/agent/contracts';
import type { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import type { AgentService } from '@/server/modules/agent/application/service/agent.service';
import type { EventBus } from '@nestjs/cqrs';
import type { Message } from '@/shared/types/entities';

const event = new TurnInitiated('conv_1', {
  conversationId: 'conv_1',
  assistantMessage: { id: 'msg_1' } as Message,
  runtimeConfig: {},
  effectiveHistory: [],
  workDir: '/tmp/w',
});

function setup(agentService: Partial<AgentService>, launch?: unknown) {
  const eventBus = { publish: vi.fn() } as unknown as EventBus;
  const handler = new AgentRunHandler(
    {
      launch:
        launch ??
        (() =>
          (async function* () {
            /* 空 run */
          })()),
    } as unknown as AgentRunExecutor,
    agentService as AgentService,
    eventBus,
  );
  return { handler, eventBus };
}

describe('AgentRunHandler——RunCompleted 恒发布(不留幻影活跃 run)', () => {
  it('buildToolSet 在 RunStarted 前抛错 → 仍发 RunCompleted(conv 侧可清理 startingTurns)', async () => {
    const { handler, eventBus } = setup({
      buildToolSet: () => {
        throw new Error('tool cache cold');
      },
    });

    await expect(handler.handle(event)).rejects.toThrow('tool cache cold');
    const completed = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls
      .map(([e]) => e)
      .find(e => e instanceof RunCompleted);
    expect(completed).toBeDefined();
    expect(completed!.payload).toMatchObject({
      conversationId: 'conv_1',
      messageId: 'msg_1',
    });
  });

  it('正常空 run → RunStarted 与 RunCompleted 成对发布', async () => {
    const { handler, eventBus } = setup({ buildToolSet: () => ({}) as never });
    await handler.handle(event);
    const types = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls.map(
      ([e]) => e.constructor.name,
    );
    expect(types).toEqual(['RunStarted', 'RunCompleted']);
  });
});
