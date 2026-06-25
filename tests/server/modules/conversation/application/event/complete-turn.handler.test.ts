import { describe, it, expect, vi } from 'vitest';
import { CompleteTurnHandler } from '@/server/modules/conversation/application/event/complete-turn.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { HistoryCompactionService } from '@/server/modules/memory/application/service/history-compaction.service';
import type { EnrichedEvent } from '@/shared/types/events';
import type { DomainEvent } from '@/server/libs/ddd';
import type { RunCompletedPayload } from '@/server/modules/conversation/contracts';

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

function mockHistoryCompaction(): HistoryCompactionService {
  return {
    compact: vi.fn().mockResolvedValue(null),
  } as unknown as HistoryCompactionService;
}

describe('CompleteTurnHandler — 终态文案持久化', () => {
  const conversationId = 'conv_1';
  const messageId = 'msg_1';
  const agentRunId = 'run_1';

  const event = {
    payload: { conversationId, messageId, agentRunId },
  } as DomainEvent<string, RunCompletedPayload>;

  function setup(eventStream: EnrichedEvent[]) {
    const sessionManager = {
      getActiveRun: vi.fn().mockReturnValue({
        eventStream,
        config: { contextSize: 8000, runtimeConfig: {} },
      }),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const messageRepo = {
      update: vi.fn().mockResolvedValue(undefined),
      findByConversationId: vi.fn().mockResolvedValue([]),
    } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentRunRepositoryPort;
    const handler = new CompleteTurnHandler(
      sessionManager,
      messageRepo,
      agentRunRepo,
      mockHistoryCompaction(),
    );
    return { handler, messageRepo, agentRunRepo, sessionManager };
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

  it('run 已不在内存时只 finalize，不写库', async () => {
    const sessionManager = {
      getActiveRun: vi.fn().mockReturnValue(undefined),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const agentRunRepo = {
      update: vi.fn(),
    } as unknown as AgentRunRepositoryPort;
    const handler = new CompleteTurnHandler(
      sessionManager,
      messageRepo,
      agentRunRepo,
      mockHistoryCompaction(),
    );

    await handler.handle(event);

    expect(messageRepo.update).not.toHaveBeenCalled();
    expect(agentRunRepo.update).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });
});
