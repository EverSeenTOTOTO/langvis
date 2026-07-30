import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { StartChatCommand, TurnInitiated } from '../../contracts';
import { projectToLlmMessages } from '../service/history-projection';
import { runConvTransforms } from '../transforms';
import { TraceContext } from '@/server/middleware/trace-context';
import Logger from '@/server/utils/logger';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  private readonly logger = Logger.child({ source: 'StartChatHandler' });

  constructor(
    @inject(ChatService)
    private chatService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, userId, assistantId } = command;
    if (TraceContext.get()) TraceContext.update({ conversationId });

    // 持久化 + 归属校验 在 ChatService.startTurn。
    const turn = await this.chatService.startTurn({
      conversationId,
      userId,
      userMessage,
      assistantId,
    });

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

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: turn.assistantMessage,
        runtimeConfig: ctx.runtimeConfig,
        effectiveHistory,
        workDir,
      }),
    );

    return { assistantId: turn.assistantMessage.id };
  }
}
