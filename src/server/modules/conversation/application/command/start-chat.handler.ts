import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { StartChatCommand, TurnInitiated } from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const userConfig = dbConversation.config;

    // 前置条件：会话必须已激活（调用方需先 activate），不再静默激活。
    await this.convService.assertActivated(conversationId);

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    // systemPrompt 取自激活时烘焙的 system 消息；agent 不再被回调取 prompt。
    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const systemPrompt = systemMessage?.content ?? '';

    const memory = this.sessionManager.getMemory(conversationId);
    memory.append(setup.userMessage);
    const effectiveHistory = await memory.buildContext();

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        userConfig,
        systemPrompt,
        effectiveHistory,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}
