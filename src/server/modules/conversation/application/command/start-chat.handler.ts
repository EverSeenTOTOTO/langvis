import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ConversationService } from '../service/conversation.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import {
  StartChatCommand,
  TurnInitiated,
  extractBinding,
} from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const binding = extractBinding(dbConversation);
    const systemPrompt = this.agentService.buildSystemPrompt(binding.agentId);

    await this.convService.activate({
      conversationId,
      userId: dbConversation.userId,
      systemPrompt,
    });

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    this.convService.startTurn(conversationId, setup.assistantMessage.id);

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const resolvedSystemPrompt = systemMessage?.content ?? systemPrompt;

    this.eventBus.emit(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        agentBinding: binding,
        systemPrompt: resolvedSystemPrompt,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}
