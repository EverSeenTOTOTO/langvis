import { describe, it, expect, vi } from 'vitest';
import { HistoryCompactedHandler } from '@/server/modules/conversation/application/event/history-compacted.handler';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { DomainEvent } from '@/server/libs/ddd';
import type { HistoryCompactedPayload } from '@/server/modules/memory';
import { Role } from '@/shared/entities/Message';

describe('HistoryCompactedHandler', () => {
  it('把压缩产物持久化为 compact 消息', async () => {
    const messageRepo = {
      batchCreate: vi.fn().mockResolvedValue([]),
    } as unknown as MessageRepositoryPort;
    const handler = new HistoryCompactedHandler(messageRepo);
    const event = {
      payload: {
        conversationId: 'conv_1',
        content: 'SUMMARY',
        startRef: 'm0',
      },
    } as DomainEvent<string, HistoryCompactedPayload>;

    await handler.handle(event);

    expect(messageRepo.batchCreate).toHaveBeenCalledWith('conv_1', [
      expect.objectContaining({
        role: Role.USER,
        content: 'SUMMARY',
        meta: { kind: 'compact', startRef: 'm0' },
      }),
    ]);
  });
});
