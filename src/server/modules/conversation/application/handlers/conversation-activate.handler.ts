import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { ConversationService } from '../conversation.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../database/conversation.repository.port';
import { AgentService } from '@/server/modules/agent/application/agent.service';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ConversationActivated } from '../../domain/events';
import { extractBinding } from '../../domain/utils';
import { ConversationActivateCommand } from '../../commands/conversation-activate.command';
import { ConversationNotFoundError } from '../../domain/conversation.errors';

@service()
export class ConversationActivateHandler {
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

    this.eventBus.emit(
      ConversationActivated,
      createDomainEvent(ConversationActivated, conversationId, {
        conversationId,
        agentBinding: binding,
      }),
    );
  }
}
