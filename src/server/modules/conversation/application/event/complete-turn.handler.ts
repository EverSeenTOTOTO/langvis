import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import type { SSEFrame } from '@/shared/types/events';
import { SessionManager } from '../service/session-manager';
import { ChatService } from '../service/chat.service';
import { RunCompleted } from '@/server/modules/agent/contracts';
import type { RunCompletedPayload } from '@/server/modules/agent/contracts';

/**
 * RunCompleted 订阅者:读 session 缓冲的 run 事件流 → 交 ChatService 投影/持久化/压缩
 * → 按返回的用量发 conversation_usage 帧。投影与压缩策略不在此处(见 ChatService.completeTurn)。
 */
@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(ChatService)
    private chatService: ChatService,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId } = event.payload;

    try {
      const events = this.sessionManager.getRunEvents(
        conversationId,
        messageId,
      );
      if (!events || events.length === 0) return;

      const memory = this.sessionManager.getMemory(conversationId);
      const usage = await this.chatService.completeTurn({
        conversationId,
        messageId,
        events,
        memory,
      });

      if (usage) {
        this.sessionManager.sendFrame(conversationId, {
          type: 'conversation_usage',
          used: usage.used,
          total: usage.total,
        } as SSEFrame);
      }
    } finally {
      this.sessionManager.finalizeRun(conversationId, messageId);
    }
  }
}
