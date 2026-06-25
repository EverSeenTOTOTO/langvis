import { inject } from 'tsyringe';
import type { Conversation } from '@/shared/entities/Conversation';
import { commandHandler } from '@/server/decorator/handler';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { ConversationUpdateCommand } from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(ConversationUpdateCommand)
export class ConversationUpdateHandler {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
  ) {}

  async execute(command: ConversationUpdateCommand): Promise<Conversation> {
    const { conversationId, userId, name, config, groupId, groupName } =
      command;
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
    return updated;
  }
}
