import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { TruncateConversationCommand } from '../../contracts';
import { MessageNotFoundError } from '../../domain/errors';

// 截断到某条消息之前：删该消息及之后（含折叠 summary），重置 ctx.messages。重发走常规发送路径。
@commandHandler(TruncateConversationCommand)
export class TruncateChatHandler {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(command: TruncateConversationCommand): Promise<void> {
    const { conversationId, messageId, userId } = command;

    await this.chatService.requireConversation(conversationId, userId);

    const messages =
      await this.chatService.getConversationMessages(conversationId);
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx < 0) throw new MessageNotFoundError(messageId);

    const toDelete = messages.slice(idx).map(m => m.id);

    // 在飞 run 及其 DB 残留先清零——reconcileOrphanedRuns 需在删除前仍看到 assistant 行。
    await this.sessionManager.cancelAllActiveRuns(
      conversationId,
      'Retry truncation',
    );
    // 屏障：等上一 turn-end 维护（compact 等）落定，别让折叠写回被截断后的残留时序覆盖。
    await this.sessionManager.awaitMaintenance(conversationId);

    await this.chatService.deleteMessages(conversationId, toDelete);

    // ctx.messages 是 LLM 历史真源，截断后须重置为删除后的剩余，否则旧消息漏进 effectiveHistory。
    if (this.sessionManager.hasCtx(conversationId)) {
      const remaining =
        await this.chatService.getConversationMessages(conversationId);
      this.sessionManager.activateContext(
        conversationId,
        remaining,
        this.sessionManager.getCtx(conversationId).runtimeConfig,
      );
    }
  }
}
