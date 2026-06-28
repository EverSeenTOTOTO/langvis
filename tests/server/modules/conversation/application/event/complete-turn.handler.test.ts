import { describe, it, expect, vi } from 'vitest';
import { CompleteTurnHandler } from '@/server/modules/conversation/application/event/complete-turn.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { EventBus, DomainEvent } from '@/server/libs/ddd';
import type { EnrichedEvent } from '@/shared/types/events';
import { HistoryCompactionRequested } from '@/server/modules/memory';
import type { RunCompletedPayload } from '@/server/modules/conversation/contracts';

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

describe('CompleteTurnHandler — 终态文案持久化 + 压缩请求', () => {
  const conversationId = 'conv_1';
  const messageId = 'msg_1';
  const agentRunId = 'run_1';

  const event = {
    payload: { conversationId, messageId, agentRunId },
  } as DomainEvent<string, RunCompletedPayload>;

  function setup(eventStream: EnrichedEvent[]) {
    const sessionManager = {
      getRunEvents: vi.fn().mockReturnValue(eventStream),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const messageRepo = {
      update: vi.fn().mockResolvedValue(undefined),
      findByConversationId: vi.fn().mockResolvedValue([]),
      batchCreate: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      // 只读：run 持久化由 agent 的 executor 拥有；此处仅供 requestCompaction 读 config。
      findById: vi.fn().mockResolvedValue({
        config: { contextSize: 8000, runtimeConfig: {} },
      }),
    } as unknown as AgentRunRepositoryPort;
    const eventBus = { dispatch: vi.fn() } as unknown as EventBus;
    const handler = new CompleteTurnHandler(
      sessionManager,
      messageRepo,
      agentRunRepo,
      eventBus,
    );
    return { handler, messageRepo, agentRunRepo, sessionManager, eventBus };
  }

  it('cancelled 且无生成文本时，内容持久化为取消原因（非空串）', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'cancelled', reason: 'Cancelled by user' }),
    ]);

    await handler.handle(event);

    expect(messageRepo.update).toHaveBeenCalledWith(messageId, {
      content: 'Cancelled by user',
    });
  });

  it('cancelled 且已有部分文本时，仍以取消原因覆盖残缺片段', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: '部分内容…' }),
      ev({ type: 'cancelled', reason: 'Cancelled by user' }),
    ]);

    await handler.handle(event);

    expect(messageRepo.update).toHaveBeenCalledWith(messageId, {
      content: 'Cancelled by user',
    });
  });

  it('failed 时内容持久化为错误信息', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'error', error: 'upstream blew up' }),
    ]);

    await handler.handle(event);

    expect(messageRepo.update).toHaveBeenCalledWith(messageId, {
      content: 'upstream blew up',
    });
  });

  it('completed 时内容为生成的文本', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: 'Hello there' }),
      ev({ type: 'final' }),
    ]);

    await handler.handle(event);

    expect(messageRepo.update).toHaveBeenCalledWith(messageId, {
      content: 'Hello there',
    });
  });

  it('有 process_summary 事件时，meta.processSummary 随内容一起持久化', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: 'final answer' }),
      ev({ type: 'process_summary', summary: 'loop 做了 X 和 Y' }),
      ev({ type: 'final' }),
    ]);

    await handler.handle(event);

    expect(messageRepo.update).toHaveBeenCalledWith(messageId, {
      content: 'final answer',
      meta: { processSummary: 'loop 做了 X 和 Y' },
    });
  });

  it('持久化终态后发 HistoryCompactionRequested（带历史 + run 配置）', async () => {
    const { handler, eventBus, messageRepo, agentRunRepo } = setup([
      ev({ type: 'start' }),
      ev({ type: 'text_chunk', content: 'hi' }),
      ev({ type: 'final' }),
    ]);
    (
      messageRepo.findByConversationId as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    (agentRunRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: {
        contextSize: 4096,
        runtimeConfig: { model: { modelId: 'gpt-4' } },
      },
    });

    await handler.handle(event);

    expect(eventBus.dispatch).toHaveBeenCalledWith(
      HistoryCompactionRequested,
      expect.objectContaining({
        type: HistoryCompactionRequested,
        aggregateId: conversationId,
        payload: expect.objectContaining({
          conversationId,
          contextSize: 4096,
          runtimeConfig: { model: { modelId: 'gpt-4' } },
          messages: [{ id: 'm1' }, { id: 'm2' }],
        }),
      }),
    );
  });

  it('run 已不在内存时只 finalize，不写库、不发压缩请求', async () => {
    const sessionManager = {
      getRunEvents: vi.fn().mockReturnValue(undefined),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      findById: vi.fn(),
    } as unknown as AgentRunRepositoryPort;
    const eventBus = { dispatch: vi.fn() } as unknown as EventBus;
    const handler = new CompleteTurnHandler(
      sessionManager,
      messageRepo,
      agentRunRepo,
      eventBus,
    );

    await handler.handle(event);

    expect(messageRepo.update).not.toHaveBeenCalled();
    expect(agentRunRepo.findById).not.toHaveBeenCalled();
    expect(eventBus.dispatch).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });
});
