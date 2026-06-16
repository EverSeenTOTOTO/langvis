import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { inject } from 'tsyringe';
import { commandHandler, eventHandler } from '@/server/decorator/handler';
import { CommandBus, EventBus, createDomainEvent } from '@/server/libs/ddd';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { CachePort } from '@/server/modules/agent/domain/cache.port';
import type { CachedReference } from '@/server/modules/memory/application/cache.service';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/database/conversation.repository.port';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import { StartChatCommand } from '@/server/modules/conversation/contracts';
import { EmailService } from './application/email.service';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
  EmailArchived,
  type EmailArchivedPayload,
} from './contracts';

// ── ArchiveEmail (command handler) ────────────────────────
// Only operates on the Email aggregate: mark archived, emit event.
// Cross-aggregate orchestration is in EmailArchivedHandler (Saga).

@commandHandler(ArchiveEmailCommand)
export class ArchiveEmailHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ArchiveEmailCommand): Promise<ArchiveEmailResult> {
    const { emailId, userId } = command;

    const email = await this.emailService.getById(emailId);
    if (!email) {
      throw new Error(`Email not found: ${emailId}`);
    }

    await this.emailService.updateStatus(emailId, 'archived');

    this.eventBus.emit(
      EmailArchived,
      createDomainEvent(EmailArchived, emailId, {
        userId,
        emailId,
        emailSubject: email.subject,
        emailContent: email.content,
        emailFrom: email.from,
        emailFromName: email.fromName,
        emailSentAt: email.sentAt.toISOString(),
        agentBinding: {
          agentId: AgentIds.REACT,
          config: {
            model: {},
            memory: { type: 'react_memory', windowSize: 10 },
          },
        },
      } satisfies EmailArchivedPayload),
    );

    return { emailId };
  }
}

// ── EmailArchived (event handler / Saga) ───────────────────
// Cross-aggregate orchestration: create conversation, compress content,
// activate + start chat. This is the Saga pattern.

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

    // 1. Create conversation (Conversation BC)
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

    // 2. Compress content (Memory BC)
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

    // 3. Activate + start chat (via commands — Chat created inside activate)
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
