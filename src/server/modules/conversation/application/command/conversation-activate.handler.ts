import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import {
  ConversationActivateCommand,
  ConversationActivated,
  extractBinding,
} from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(ConversationActivateCommand)
export class ConversationActivateHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: ConversationActivateCommand): Promise<void> {
    const { conversationId, userId } = command;
    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    const binding = extractBinding(dbConversation);
    const systemPrompt = this.agentService.buildSystemPrompt(binding.agentId);

    await this.convService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    this.eventBus.dispatch(
      ConversationActivated,
      createDomainEvent(ConversationActivated, conversationId, {
        conversationId,
        agentBinding: binding,
      }),
    );
  }
}
