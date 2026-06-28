import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { HistoryCompactionRequested, HistoryCompacted } from '../../contracts';
import type { HistoryCompactionRequestedPayload } from '../../contracts';
import { HistoryCompactionService } from '../service/history-compaction.service';

/**
 * HistoryCompactionHandler —— 监听 conv 的压缩请求，计算历史层压缩。
 *
 * 数据全在 payload（messages/contextSize/runtimeConfig）——**HistoryCompactionService 保持
 * repo-free**，memory 不读会话 repo。有结果则发 HistoryCompacted，让 conv 持久化 compact 消息
 * （消息存储写是 conv 的职责）。异常 warn 吞掉（压缩失败不影响 turn）。
 */
@eventHandler(HistoryCompactionRequested)
export class HistoryCompactionHandler {
  private readonly logger = Logger.child({
    source: 'HistoryCompactionHandler',
  });

  constructor(
    @inject(HistoryCompactionService)
    private readonly compaction: HistoryCompactionService,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async handle(
    event: DomainEvent<string, HistoryCompactionRequestedPayload>,
  ): Promise<void> {
    const { conversationId, messages, contextSize, runtimeConfig } =
      event.payload;
    const controller = new AbortController();
    try {
      const result = await this.compaction.compact({
        messages,
        contextSize,
        runtimeConfig,
        signal: controller.signal,
      });
      if (!result) return;

      this.eventBus.dispatch(
        HistoryCompacted,
        createDomainEvent(HistoryCompacted, conversationId, {
          conversationId,
          content: result.content,
          startRef: result.startRef,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `History compaction failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
