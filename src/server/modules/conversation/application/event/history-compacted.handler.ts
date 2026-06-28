import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { HistoryCompacted } from '@/server/modules/memory';
import type { HistoryCompactedPayload } from '@/server/modules/memory';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { Role } from '@/shared/entities/Message';
import Logger from '@/server/utils/logger';

/**
 * HistoryCompactedHandler —— 监听 memory 的压缩产物，持久化为 compact 消息。
 *
 * 压缩算法是 memory 的职责（经事件往返触发），消息存储写是 conversation 的职责——
 * 故 memory 不碰 repo、conv 负责落盘。compact 消息（meta.kind==='compact'）hidden，
 * 供后续 turn 的 ConversationMemory 取作有效历史前缀。
 */
@eventHandler(HistoryCompacted)
export class HistoryCompactedHandler {
  private readonly logger = Logger.child({ source: 'HistoryCompactedHandler' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
  ) {}

  async handle(
    event: DomainEvent<string, HistoryCompactedPayload>,
  ): Promise<void> {
    const { conversationId, content, startRef } = event.payload;
    try {
      await this.messageRepo.batchCreate(conversationId, [
        {
          role: Role.USER,
          content,
          meta: { kind: 'compact', startRef },
          createdAt: new Date(),
        },
      ]);
    } catch (err) {
      this.logger.warn(
        `Persisting compacted history failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
