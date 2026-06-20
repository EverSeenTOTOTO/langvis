import { inject } from 'tsyringe';
import type { Conversation } from '@/shared/entities/Conversation';
import { commandHandler } from '@/server/decorator/handler';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { ConversationUpdateCommand } from '../../contracts';
import {
  AgentImmutableError,
  ConversationNotFoundError,
} from '../../domain/errors';

/**
 * 前置条件：会话的 agent 绑定在创建后不可变。
 * SYSTEM 首条消息（基于 agent 构建）一旦发出即冻结为历史，
 * 后续 update 若改写 config.agent 会造成历史 prompt 与后续 turn 错配。
 */
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

    if (config !== undefined) {
      const newAgent = config?.agent;
      if (newAgent !== existing.config?.agent) {
        throw new AgentImmutableError(conversationId);
      }
    }

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
