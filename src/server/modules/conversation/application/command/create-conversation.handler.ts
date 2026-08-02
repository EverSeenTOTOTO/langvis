import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import type { Conversation } from '@/shared/types/entities';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { CreateConversationCommand } from '../../contracts';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

// 会话创建统一入口，取代各调用方直连 convRepo.create。workspacePath 未传时由 WorkspaceService 生成临时路径。
@commandHandler(CreateConversationCommand)
export class CreateConversationHandler {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async execute(command: CreateConversationCommand): Promise<Conversation> {
    const workspacePath =
      command.workspacePath ?? this.workspaceService.generateEphemeralPath();
    return this.convRepo.create(
      command.name,
      command.userId,
      command.config,
      command.groupId,
      command.groupName,
      workspacePath,
    );
  }
}
