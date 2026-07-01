import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import type { Conversation } from '@/shared/types/entities';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { CreateConversationCommand } from '../../contracts';

/**
 * 「创建会话」用例的唯一 application 入口(conv 自身 HTTP 创建 + email 归档等都走这里),
 * 取代各调用方直连 convRepo.create。group 解析 / order 计算暂留 repo 内(后续可上移)。
 */
@commandHandler(CreateConversationCommand)
export class CreateConversationHandler {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
  ) {}

  async execute(command: CreateConversationCommand): Promise<Conversation> {
    return this.convRepo.create(
      command.name,
      command.userId,
      command.config,
      command.groupId,
      command.groupName,
    );
  }
}
