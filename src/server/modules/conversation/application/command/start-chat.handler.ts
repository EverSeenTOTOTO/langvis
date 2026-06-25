import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import {
  StartChatCommand,
  TurnInitiated,
  extractUserConfig,
} from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
    @inject(AgentService)
    private readonly agentService: AgentService,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const userConfig = extractUserConfig(dbConversation);
    const systemPrompt = await this.agentService.getSystemPrompt();

    // 前置条件：会话必须已激活（调用方需先 activate）。不再静默激活。
    await this.convService.assertActivated(conversationId);

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const resolvedSystemPrompt = systemMessage?.content ?? systemPrompt;

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        userConfig,
        systemPrompt: resolvedSystemPrompt,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}
