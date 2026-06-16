import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import { CommandBus } from '@/server/libs/ddd';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { CachedReference } from '@/server/modules/memory/infrastructure/cache.provider';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import { StartChatCommand } from '@/server/modules/conversation/contracts';
import { Role } from '@/shared/entities/Message';
import { EmailArchived, type EmailArchivedPayload } from '../../contracts';

@eventHandler(EmailArchived)
export class EmailArchivedHandler {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
    @inject(ProviderService)
    private readonly providerService: ProviderService,
    @inject(CACHE_SERVICE)
    private readonly cacheService: CachePort,
    @inject(CommandBus)
    private readonly commandBus: CommandBus,
  ) {}

  async handle(event: { payload: EmailArchivedPayload }): Promise<void> {
    const {
      userId,
      emailSubject,
      emailContent,
      emailFrom,
      emailFromName,
      emailSentAt,
      agentBinding,
    } = event.payload;

    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.convRepo.create(
      `归档邮件: ${emailSubject}`,
      userId,
      {
        agent: agentBinding.agentId,
        model: { modelId: defaultModel?.id },
        memory: agentBinding.config?.memory ?? {
          type: 'react_memory',
          windowSize: 10,
        },
      },
      null,
      'Email Archive',
    );

    const contentOrCached = (await this.cacheService.compress(
      conversation.id,
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
      new ConversationActivateCommand(conversation.id, userId),
    );

    await this.commandBus.execute(
      new StartChatCommand(conversation.id, {
        role: Role.USER,
        content: userContent,
      }),
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
