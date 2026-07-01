import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { StartChatCommand, TurnInitiated } from '../../contracts';

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

    // 持久化 + 归属校验 + systemPrompt 推导 在 ChatService.startTurn;
    // memory 与事件派发是 session 作用域 / I/O,留 handler。
    const turn = await this.chatService.startTurn({
      conversationId,
      userId,
      userMessage,
      assistantId,
    });

    const memory = this.sessionManager.getMemory(conversationId);
    memory.append(turn.userMessage);
    const effectiveHistory = await memory.buildContext();

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: turn.assistantMessage,
        userConfig: turn.userConfig,
        systemPrompt: turn.systemPrompt,
        effectiveHistory,
      }),
    );

    return { assistantId: turn.assistantMessage.id };
  }
}
