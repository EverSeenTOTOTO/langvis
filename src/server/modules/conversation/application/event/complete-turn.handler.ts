import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { projectRun } from '../service/run-projection';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { SSEFrame } from '@/shared/types/events';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';
import Logger from '@/server/utils/logger';
import { isEmpty } from 'lodash-es';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  private readonly logger = Logger.child({ source: 'CompleteTurnHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId } = event.payload;

    // 从会话缓冲的事件流投影最终状态（事实源 → 读模型）
    const events = this.sessionManager.getRunEvents(conversationId, messageId);

    if (events && events.length > 0) {
      const view = projectRun(events);
      const content = view.content;
      const meta: Record<string, unknown> = {};

      if (view.processSummary) meta.processSummary = view.processSummary;
      if (view.audio) meta.audio = view.audio;

      const updated = await this.messageRepo.update(
        messageId,
        isEmpty(meta) ? { content } : { content, meta },
      );

      await this.compactHistory(conversationId, updated);
    }

    this.sessionManager.finalizeRun(conversationId, messageId);
  }

  private async compactHistory(
    conversationId: string,
    assistantMessage: Message | null,
  ): Promise<void> {
    try {
      const memory = this.sessionManager.getMemory(conversationId);
      if (assistantMessage) {
        memory.append(assistantMessage);
      }
      const result = await memory.compact(new AbortController().signal);
      if (result) {
        const [compactMessage] = await this.messageRepo.batchCreate(
          conversationId,
          [
            {
              role: Role.USER,
              content: result.content,
              meta: { kind: 'compact', startRef: result.startRef },
              createdAt: new Date(),
            },
          ],
        );
        memory.append(compactMessage);
        this.sendUsage(conversationId, result.usage.used, result.usage.total);
      } else {
        const usage = memory.getContextUsage();
        this.sendUsage(conversationId, usage.used, usage.total);
      }
    } catch (err) {
      this.logger.warn(
        `Post-turn memory maintenance failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private sendUsage(conversationId: string, used: number, total: number): void {
    this.sessionManager.sendFrame(conversationId, {
      type: 'conversation_usage',
      used,
      total,
    } as SSEFrame);
  }
}
