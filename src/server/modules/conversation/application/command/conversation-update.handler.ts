import { Inject } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import type { Conversation } from '@/shared/entities/Conversation';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { ConversationUpdateCommand } from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { TraceContext } from '@/server/trace-context';

@CommandHandler(ConversationUpdateCommand)
export class ConversationUpdateHandler {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @Inject(ChatService)
    private chatService: ChatService,
    @Inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(command: ConversationUpdateCommand): Promise<Conversation> {
    const { conversationId, userId, name, config, groupId, groupName } =
      command;
    if (TraceContext.get()) TraceContext.update({ conversationId });
    const existing = await this.convRepo.findById(conversationId, userId);
    if (!existing) throw new ConversationNotFoundError(conversationId);

    const updated = await this.convRepo.update(
      conversationId,
      name,
      userId,
      config ?? undefined,
      groupId ?? undefined,
      groupName ?? undefined,
    );
    if (!updated) throw new ConversationNotFoundError(conversationId);

    if (config) {
      const runtimeConfig =
        await this.chatService.resolveConversationConfig(conversationId);
      if (runtimeConfig) {
        this.sessionManager.refreshRuntimeConfig(conversationId, runtimeConfig);
      }
    }

    return updated;
  }
}
