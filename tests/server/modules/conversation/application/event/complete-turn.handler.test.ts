import { describe, it, expect, vi } from 'vitest';
import { CompleteTurnHandler } from '@/server/modules/conversation/application/event/complete-turn.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { ConversationMemoryPort } from '@/server/modules/memory';
import type { DomainEvent } from '@/server/libs/ddd';
import type { EnrichedEvent } from '@/shared/types/events';
import type { RunCompletedPayload } from '@/server/modules/conversation/contracts';

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

describe('CompleteTurnHandler — 终态文案持久化 + 历史压缩', () => {
  const conversationId = 'conv_1';
  const messageId = 'msg_1';
  const agentRunId = 'run_1';

  const event = {
    payload: { conversationId, messageId, agentRunId },
  } as DomainEvent<string, RunCompletedPayload>;

  function setup(
    eventStream: EnrichedEvent[] | undefined,
    opts: {
      compactResult?: {
        content: string;
        startRef: string;
        usage: { used: number; total: number };
      } | null;
      usage?: { used: number; total: number };
    } = {},
  ) {
    const sessionManager = {
      getRunEvents: vi.fn().mockReturnValue(eventStream),
      finalizeRun: vi.fn(),
      sendFrame: vi.fn().mockReturnValue(true),
    } as unknown as SessionManager;
    const messageRepo = {
      update: vi.fn().mockResolvedValue({
        id: messageId,
        role: 'assistant',
        content: '<persisted>',
      }),
      batchCreate: vi.fn().mockResolvedValue([
        {
          id: 'compact_1',
          role: 'user',
          content: opts.compactResult?.content,
        },
      ]),
    } as unknown as MessageRepositoryPort;
    const convMemory = {
      append: vi.fn(),
      compact: vi.fn().mockResolvedValue(opts.compactResult ?? null),
      getUsage: vi.fn().mockReturnValue(opts.usage ?? { used: 0, total: 8000 }),
    } as unknown as ConversationMemoryPort;
    const handler = new CompleteTurnHandler(
      sessionManager,
      messageRepo,
      convMemory,
    );
    return { handler, messageRepo, sessionManager, convMemory };
  }

  it('cancelled 且无生成文本时，内容持久化为取消原因', async () => {
    const { handler, messageRepo } = setup([
      ev({ type: 'start' }),
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

  it('有 process_summary 时 meta.processSummary 随内容持久化', async () => {
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

  it('压缩有结果时：落盘 compact 消息、append 回 memory、发 conversation_usage', async () => {
    const { handler, messageRepo, sessionManager, convMemory } = setup(
      [
        ev({ type: 'start' }),
        ev({ type: 'text_chunk', content: 'hi' }),
        ev({ type: 'final' }),
      ],
      {
        compactResult: {
          content: 'SUMMARY',
          startRef: 'm1',
          usage: { used: 5, total: 4096 },
        },
      },
    );

    await handler.handle(event);

    expect(convMemory.compact).toHaveBeenCalledWith(
      conversationId,
      expect.any(AbortSignal),
    );
    expect(messageRepo.batchCreate).toHaveBeenCalledWith(conversationId, [
      expect.objectContaining({
        content: 'SUMMARY',
        meta: { kind: 'compact', startRef: 'm1' },
      }),
    ]);
    // assistant 消息 + compact 消息都 append 回 memory。
    expect(convMemory.append).toHaveBeenCalledTimes(2);
    expect(sessionManager.sendFrame).toHaveBeenCalledWith(conversationId, {
      type: 'conversation_usage',
      used: 5,
      total: 4096,
    });
  });

  it('压缩未超阈（返回 null）时：发 ConvMemory 自算的 conversation_usage', async () => {
    const { handler, sessionManager, convMemory } = setup(
      [
        ev({ type: 'start' }),
        ev({ type: 'text_chunk', content: 'hi' }),
        ev({ type: 'final' }),
      ],
      { compactResult: null, usage: { used: 42, total: 8000 } },
    );

    await handler.handle(event);

    expect(convMemory.getUsage).toHaveBeenCalledWith(conversationId);
    expect(sessionManager.sendFrame).toHaveBeenCalledWith(conversationId, {
      type: 'conversation_usage',
      used: 42,
      total: 8000,
    });
  });

  it('run 已不在内存时只 finalize，不写库、不压缩', async () => {
    const { handler, messageRepo, sessionManager, convMemory } =
      setup(undefined);

    await handler.handle(event);

    expect(messageRepo.update).not.toHaveBeenCalled();
    expect(convMemory.compact).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });
});
