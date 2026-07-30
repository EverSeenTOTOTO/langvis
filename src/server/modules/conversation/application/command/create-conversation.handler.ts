import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import type { Conversation } from '@/shared/types/entities';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { CreateConversationCommand } from '../../contracts';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

/**
 * 「创建会话」用例的唯一 application 入口(conv 自身 HTTP 创建 + email 归档等都走这里),
 * 取代各调用方直连 convRepo.create。group 解析 / order 计算暂留 repo 内(后续可上移)。
 * workspacePath:CLI 传 cwd 直存;web 不传→WorkspaceService 生成临时 /tmp。
 */
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
