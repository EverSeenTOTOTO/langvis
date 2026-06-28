import { describe, it, expect, vi } from 'vitest';
import { HistoryCompactionHandler } from '@/server/modules/memory/application/event/history-compaction.handler';
import type { HistoryCompactionService } from '@/server/modules/memory/application/service/history-compaction.service';
import type { DomainEvent, EventBus } from '@/server/libs/ddd';
import { HistoryCompacted } from '@/server/modules/memory/contracts';
import type { HistoryCompactionRequestedPayload } from '@/server/modules/memory/contracts';

function makeEvent(payload: Partial<HistoryCompactionRequestedPayload>) {
  return {
    payload: {
      conversationId: 'conv_1',
      messages: [],
      contextSize: 8000,
      runtimeConfig: {},
      ...payload,
    },
  } as DomainEvent<string, HistoryCompactionRequestedPayload>;
}

function makeHandler(compactImpl: ReturnType<typeof vi.fn>) {
  const compaction = {
    compact: compactImpl,
  } as unknown as HistoryCompactionService;
  const eventBus = { dispatch: vi.fn() } as unknown as EventBus;
  const handler = new HistoryCompactionHandler(compaction, eventBus);
  return { handler, eventBus, compactImpl };
}

describe('HistoryCompactionHandler', () => {
  it('compact 有结果时发 HistoryCompacted（带 content/startRef）', async () => {
    const compact = vi
      .fn()
      .mockResolvedValue({ content: 'SUMMARY', startRef: 'm0' });
    const { handler, eventBus } = makeHandler(compact);

    await handler.handle(makeEvent({}));

    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({ contextSize: 8000, messages: [] }),
    );
    expect(eventBus.dispatch).toHaveBeenCalledWith(
      HistoryCompacted,
      expect.objectContaining({
        type: HistoryCompacted,
        payload: expect.objectContaining({
          content: 'SUMMARY',
          startRef: 'm0',
        }),
      }),
    );
  });

  it('compact 返回 null（未超阈）时不发事件', async () => {
    const compact = vi.fn().mockResolvedValue(null);
    const { handler, eventBus } = makeHandler(compact);

    await handler.handle(makeEvent({}));

    expect(eventBus.dispatch).not.toHaveBeenCalled();
  });

  it('compact 抛错时不向上抛、不发事件', async () => {
    const compact = vi.fn().mockRejectedValue(new Error('boom'));
    const { handler, eventBus } = makeHandler(compact);

    await expect(handler.handle(makeEvent({}))).resolves.toBeUndefined();
    expect(eventBus.dispatch).not.toHaveBeenCalled();
  });
});
