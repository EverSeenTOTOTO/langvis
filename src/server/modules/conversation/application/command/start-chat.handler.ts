import { Inject } from '@nestjs/common';
import { CommandHandler, EventBus } from '@nestjs/cqrs';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { StartChatCommand, TurnInitiated } from '../../contracts';
import { projectToLlmMessages } from '../service/history-projection';
import { runConvTransforms } from '../transforms';
import { expandMentions } from '../service/file-mention';
import { TraceContext } from '@/server/trace-context';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';
import Logger from '@/server/utils/logger';

@CommandHandler(StartChatCommand)
export class StartChatHandler {
  private readonly logger = Logger.child({ source: 'StartChatHandler' });

  constructor(
    @Inject(ChatService)
    private chatService: ChatService,
    @Inject(SessionManager)
    private sessionManager: SessionManager,
    @Inject(EventBus)
    private eventBus: EventBus,
    @Inject(WorkspaceService)
    private workspace: WorkspaceService,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, userId, assistantId } = command;
    if (TraceContext.get()) TraceContext.update({ conversationId });

    // 会话锁内完成「排队判定 → 持久化 → 登记」：与 rewind 截断、并发发起互斥
    // （check-then-act 竞态的内存侧同步——DB 事务看不见 activeRuns，互斥必须在进程内）。
    return this.sessionManager.withConversationLock(
      conversationId,
      async () => {
        // steering（排队语义）：活跃 run 期间不并发——持久化 turn 只发 queued 帧，
        // 本轮 RunCompleted 后 CompleteTurnHandler 出队自动发起（drainQueuedTurn）。
        if (this.sessionManager.hasActiveRuns(conversationId)) {
          const queued = await this.chatService.startTurn({
            conversationId,
            userId,
            userMessage,
            assistantId,
          });
          const queuedId = queued.assistantMessage.id;
          this.sessionManager.enqueueTurn(conversationId, queuedId);
          this.sessionManager.sendFrame(conversationId, {
            type: 'queued',
            content: userMessage.content,
            assistantMessageId: queuedId,
          });
          this.logger.info(`Turn queued (active run in flight)`, {
            chatId: conversationId,
            assistantId: queuedId,
          });
          return { assistantId: queuedId };
        }

        // 持久化 + 归属校验 在 ChatService.startTurn。
        const turn = await this.chatService.startTurn({
          conversationId,
          userId,
          userMessage,
          assistantId,
        });
        // 持久化即登记：RunStarted 前的窗口里 rewind/并发发起都能看见本 turn
        this.sessionManager.markTurnStarting(
          conversationId,
          turn.assistantMessage.id,
        );

        try {
          // 屏障：等上一个 turn-end 维护（compact 等）完成后再动 ctx.messages——
          // 否则 compact 的 C 会落在本次 userMessage 之后、被位置投影丢掉。
          const maintStart = Date.now();
          await this.sessionManager.awaitMaintenance(conversationId);
          const maintWaitMs = Date.now() - maintStart;
          if (maintWaitMs > 0) {
            this.logger.info(`Turn waited for prior turn-end maintenance`, {
              maintWaitMs,
            });
          }

          const ctx = this.sessionManager.getCtx(conversationId);
          ctx.messages.push(turn.userMessage);

          // @file 引用展开（服务端模型）：注入进 LLM 上下文，消息原文保持 @token 不动
          const mentionExpansion = await expandMentions(
            userMessage.content,
            await this.chatService.resolveWorkDir(conversationId, userId),
            this.workspace,
          );
          if (mentionExpansion) {
            ctx.messages.push({
              id: `${turn.userMessage.id}:files`,
              role: 'user',
              content: mentionExpansion,
              createdAt: turn.userMessage.createdAt,
            } as typeof turn.userMessage);
          }

          // turn-start transform：本相位当前仅 summary-bake 类无（process-summary 在 turn-end 烘 meta.summary）；
          // projectToLlmMessages 读 msg.meta.summary 透传至 agent 种子作 thought。
          for await (const frame of runConvTransforms(ctx, 'turn-start')) {
            if (frame) this.sessionManager.sendFrame(conversationId, frame);
          }
          const effectiveHistory = projectToLlmMessages(ctx.messages);
          const workDir = await this.chatService.resolveWorkDir(
            conversationId,
            userId,
          );

          this.eventBus.publish(
            new TurnInitiated(conversationId, {
              conversationId,
              assistantMessage: turn.assistantMessage,
              runtimeConfig: ctx.runtimeConfig,
              effectiveHistory,
              workDir,
            }),
          );
        } catch (err) {
          this.sessionManager.unmarkTurnStarting(
            conversationId,
            turn.assistantMessage.id,
          );
          throw err;
        }

        return { assistantId: turn.assistantMessage.id };
      },
    );
  }
}
