import { inject, singleton } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { RunCompleted } from '@/server/modules/agent/contracts';
import type { RunCompletedPayload } from '@/server/modules/agent/contracts';
import { SessionManager } from '../service/session-manager';
import { ChatService } from '../service/chat.service';
import { runConvTransforms } from '../transforms';
import Logger from '@/server/utils/logger';

/**
 * RunCompleted 订阅者：turn-end 触发适配器。线性编排——
 * 开屏障 → 投影+持久化+append assistant → 发终态 run_view + 「涨」用量 → runConvTransforms(turn-end)
 * → finally 关屏障 + finalizeRun（恒执行，任何抛错都不漏 run）。
 */
@singleton()
@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  private readonly logger = Logger.child({ source: 'CompleteTurnHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(ChatService)
    private chatService: ChatService,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;
    await this.sessionManager.awaitMaintenance(conversationId);

    const events = this.sessionManager.getRunEvents(conversationId, messageId);
    if (!events || events.length === 0) {
      this.sessionManager.finalizeRun(conversationId, messageId);
      return;
    }

    const ctx = this.sessionManager.getCtx(conversationId);

    this.sessionManager.beginMaintenance(conversationId);
    try {
      const content =
        this.sessionManager.getFinalContent(conversationId, messageId) ?? '';
      const assistant = await this.chatService.persistAssistantContent(
        messageId,
        content,
      );
      if (assistant) ctx.messages = ctx.messages.append(assistant);

      this.sessionManager.flushRunView(conversationId, messageId);
      // turn-end transform（process-summary 烘焙 meta.summary → compact 折叠历史 → usage 量压缩后用量）。
      // runCtx 透传本次 RunCompleted 的 run 标识，供 per-run transform（如 process-summary）取 events。
      for await (const frame of runConvTransforms(ctx, 'turn-end', {
        messageId,
        runId: agentRunId,
      })) {
        if (frame) this.sessionManager.sendFrame(conversationId, frame);
      }
    } catch (err) {
      this.logger.warn(
        `turn-end maintenance failed: ${(err as Error)?.message ?? err}`,
      );
    } finally {
      this.sessionManager.endMaintenance(conversationId);
      this.sessionManager.finalizeRun(conversationId, messageId);
    }
  }
}
