import { Inject } from '@nestjs/common';
import { QueryHandler } from '@nestjs/cqrs';
import type { Conversation } from '@/shared/types/entities';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { GetConversationsByWorkspaceQuery } from '../../contracts';

/** /resume：按 workspace path 列出该用户在该目录下的会话（新到旧）。 */
@QueryHandler(GetConversationsByWorkspaceQuery)
export class GetConversationsByWorkspaceHandler {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
  ) {}

  async execute(
    query: GetConversationsByWorkspaceQuery,
  ): Promise<Conversation[]> {
    return this.convRepo.findByWorkspacePath(query.workspacePath, query.userId);
  }
}
