import { Inject } from '@nestjs/common';
import { QueryHandler } from '@nestjs/cqrs';
import type { Conversation } from '@/shared/types/entities';
import {
  CONVERSATION_REPOSITORY,
  MESSAGE_REPOSITORY,
} from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { GetConversationsByWorkspaceQuery } from '../../contracts';

export type WorkspaceConversationView = Conversation & {
  messageCount: number;
  lastUserMessage: string | null;
};

/** /resume：按 workspace path 列出该用户在该目录下的会话（新到旧）+ 消息统计。 */
@QueryHandler(GetConversationsByWorkspaceQuery)
export class GetConversationsByWorkspaceHandler {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
  ) {}

  async execute(
    query: GetConversationsByWorkspaceQuery,
  ): Promise<WorkspaceConversationView[]> {
    const conversations = await this.convRepo.findByWorkspacePath(
      query.workspacePath,
      query.userId,
    );
    const stats = await this.messageRepo.statsForConversations(
      conversations.map(c => c.id),
    );
    return conversations.map(c => ({
      ...c,
      messageCount: stats.get(c.id)?.count ?? 0,
      lastUserMessage: stats.get(c.id)?.lastUserMessage ?? null,
    }));
  }
}
