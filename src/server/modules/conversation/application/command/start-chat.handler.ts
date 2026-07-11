import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { StartChatCommand, TurnInitiated } from '../../contracts';
import { projectToLlmMessages } from '../../domain/model/history-projection';
import { runConvTransforms } from '../transforms';

@commandHandler(StartChatCommand)
export class StartChatHandler {
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

    // 持久化 + 归属校验 + systemPrompt 推导 在 ChatService.startTurn。
    const turn = await this.chatService.startTurn({
      conversationId,
      userId,
      userMessage,
      assistantId,
    });

    // 屏障：等在飞 turn-end 维护（compact 等）完成后再动 ctx.messages——
    // 否则 compact 的 C 会落在本次 userMessage 之后、被位置投影丢掉。
    await this.sessionManager.awaitMaintenance(conversationId);

    const ctx = this.sessionManager.getCtx(conversationId);
    ctx.messages = ctx.messages.append(turn.userMessage);

    // turn-start transform（summary-bake 把 processSummary 烘进 ctx.messages）；投影读已变换的列表。
    for await (const frame of runConvTransforms(ctx, 'turn-start')) {
      if (frame) this.sessionManager.sendFrame(conversationId, frame);
    }
    const effectiveHistory = projectToLlmMessages(ctx.messages.toArray());

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: turn.assistantMessage,
        config: ctx.config,
        systemPrompt: turn.systemPrompt,
        effectiveHistory,
      }),
    );

    return { assistantId: turn.assistantMessage.id };
  }
}
