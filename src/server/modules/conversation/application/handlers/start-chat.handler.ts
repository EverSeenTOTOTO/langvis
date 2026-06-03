import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { service } from '@/server/decorator/service';
import { ConversationService } from '../conversation.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../database/conversation.repository.port';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ChatStarted } from '../../domain/events';
import { extractBinding } from '../../domain/utils';
import { StartChatCommand } from '../../commands/start-chat.command';

@service()
export class StartChatHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const systemPrompt = systemMessage?.content ?? '';

    const dbConversation = await this.convRepo.findById(conversationId);
    const binding = extractBinding(dbConversation!);

    this.eventBus.emit(
      ChatStarted,
      createDomainEvent(ChatStarted, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        agentBinding: binding,
        systemPrompt,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}
