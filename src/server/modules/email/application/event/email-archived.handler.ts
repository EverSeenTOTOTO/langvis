import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import { CommandBus } from '@/server/libs/ddd';
import { CACHE_PORT } from '@/server/modules/agent/agent.di-tokens';
import type {
  CachePort,
  CachedReference,
} from '@/server/modules/agent/domain/port/cache.port';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import { StartChatCommand } from '@/server/modules/conversation/contracts';
import { Role } from '@/shared/entities/Message';
import { EmailArchived, type EmailArchivedPayload } from '../../contracts';

@eventHandler(EmailArchived)
export class EmailArchivedHandler {
  constructor(
    @inject(CACHE_PORT)
    private readonly cacheService: CachePort,
    @inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
    @inject(CommandBus)
    private readonly commandBus: CommandBus,
  ) {}

  async handle(event: { payload: EmailArchivedPayload }): Promise<void> {
    const {
      userId,
      conversationId,
      emailSubject,
      emailContent,
      emailFrom,
      emailFromName,
      emailSentAt,
    } = event.payload;

    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const contentOrCached = (await this.cacheService.compress(
      workDir,
      emailContent,
    )) as string | CachedReference;
    const userContent = this.buildArchivePrompt(
      emailSubject,
      emailFrom,
      emailFromName,
      emailSentAt,
      contentOrCached,
    );

    await this.commandBus.execute(
      new ConversationActivateCommand(conversationId, userId),
    );

    await this.commandBus.execute(
      new StartChatCommand(
        conversationId,
        {
          role: Role.USER,
          content: userContent,
        },
        userId,
      ),
    );
  }

  private buildArchivePrompt(
    subject: string,
    from: string,
    fromName: string | null,
    sentAt: string,
    contentOrCached: string | CachedReference,
  ): string {
    const fromDisplay = fromName ? `${fromName} <${from}>` : from;

    if (typeof contentOrCached === 'string') {
      return `使用 document_archive 技能归档邮件：${subject}\n\n发件人：${fromDisplay}\n发件时间：${sentAt}\n\n内容：\n${contentOrCached}`;
    }

    return `使用 document_archive 技能归档邮件：${subject}\n\n发件人：${fromDisplay}\n发件时间：${sentAt}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }
}
