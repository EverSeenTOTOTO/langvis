import { Inject } from '@nestjs/common';
import { EventBus, EventsHandler } from '@nestjs/cqrs';
import { RunCompleted } from '@/server/modules/agent/contracts';
import { SessionManager } from '../service/session-manager';
import { ChatService } from '../service/chat.service';
import { runConvTransforms } from '../transforms';
import { TurnInitiated } from '../../contracts';
import { projectToLlmMessages } from '../service/history-projection';
import { ChatService as Svc } from '../service/chat.service';
import Logger from '@/server/utils/logger';

// RunCompleted 订阅者，线性编排 turn-end；finalizeRun 恒执行，抛错也不漏 run。
@EventsHandler(RunCompleted)
export class CompleteTurnHandler {
  private readonly logger = Logger.child({ source: 'CompleteTurnHandler' });

  constructor(
    @Inject(SessionManager)
    private sessionManager: SessionManager,
    @Inject(ChatService)
    private chatService: Svc,
    @Inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async handle(event: RunCompleted): Promise<void> {
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
      if (assistant) ctx.messages.push(assistant);

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
      this.drainQueuedTurn(conversationId).catch(err => {
        this.logger.error(`drain queued turn failed: ${err}`);
      });
    }
  }

  /** steering 出队：本轮结束后 FIFO 发起下一个排队 turn（turn 已持久化，只补 ctx 投影与 TurnInitiated）。 */
  private async drainQueuedTurn(conversationId: string): Promise<void> {
    const assistantId = this.sessionManager.dequeueTurn(conversationId);
    if (!assistantId) return;

    const ctx = this.sessionManager.getCtx(conversationId);
    const { turns, workDir } = await this.chatService.listPendingTurns(
      conversationId,
      [assistantId],
    );
    if (turns.length === 0) {
      this.logger.warn(`queued turn missing persisted pair`, {
        chatId: conversationId,
        assistantId,
      });
      return;
    }
    for (const turn of turns) ctx.messages.push(turn.userMessage);

    for await (const frame of runConvTransforms(ctx, 'turn-start')) {
      if (frame) this.sessionManager.sendFrame(conversationId, frame);
    }

    this.eventBus.publish(
      new TurnInitiated(conversationId, {
        conversationId,
        assistantMessage: turns[0]!.assistantMessage,
        runtimeConfig: ctx.runtimeConfig,
        effectiveHistory: projectToLlmMessages(ctx.messages),
        workDir,
      }),
    );
    this.logger.info(`Drained queued turn`, {
      chatId: conversationId,
      assistantId,
    });
  }
}
