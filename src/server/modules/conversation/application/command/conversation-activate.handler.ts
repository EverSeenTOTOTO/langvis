import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import {
  ConversationActivateCommand,
  ConversationActivated,
} from '../../contracts';
import {
  ConversationForbiddenError,
  ConversationNotFoundError,
} from '../../domain/errors';

@commandHandler(ConversationActivateCommand)
export class ConversationActivateHandler {
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

  async execute(command: ConversationActivateCommand): Promise<void> {
    const { conversationId, userId } = command;
    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (dbConversation.userId !== userId) {
      throw new ConversationForbiddenError(conversationId, userId);
    }

    const systemPrompt = await this.agentService.getSystemPrompt();

    await this.convService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    this.eventBus.dispatch(
      ConversationActivated,
      createDomainEvent(ConversationActivated, conversationId, {
        conversationId,
      }),
    );
  }
}
