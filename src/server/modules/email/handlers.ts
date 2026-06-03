import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { inject } from 'tsyringe';
import { commandHandler, eventHandler } from '@/server/decorator/handler';
import { CommandBus, EventBus, createDomainEvent } from '@/server/libs/ddd';
import {
  CacheService,
  type CachedReference,
} from '@/server/modules/memory/services/cache.service';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { ConversationService } from '@/server/modules/conversation/application/conversation.service';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/database/conversation.repository.port';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import { StartChatCommand } from '@/server/modules/conversation/contracts';
import { EmailService } from './domain/email.service';
import type { EmailEntity } from '@/shared/entities/Email';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
  EmailArchived,
  type EmailArchivedPayload,
} from './contracts';

// ── ArchiveEmail (command handler) ────────────────────────
// Only handles the email aggregate: mark archived, create conversation,
// compress content, then emit EmailArchived event.
// Cross-aggregate orchestration (activate + startChat) is in EmailArchivedHandler.

@commandHandler(ArchiveEmailCommand)
export class ArchiveEmailHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
    @inject(ProviderService)
    private readonly providerService: ProviderService,
    @inject(CacheService)
    private readonly cacheService: CacheService,
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

    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.convRepo.create(
      `归档邮件: ${email.subject}`,
      userId,
      {
        agent: AgentIds.REACT,
        model: { modelId: defaultModel?.id },
        memory: {
          type: 'react_memory',
          windowSize: 10,
        },
      },
      null,
      'Email Archive',
    );

    if (userId !== conversation.userId) {
      throw new Error(`Mismatched conversation user: ${userId}`);
    }

    const contentOrCached = await this.cacheService.compress(
      conversation.id,
      email.content,
    );
    const userContent = this.buildArchivePrompt(
      email,
      contentOrCached as string | CachedReference,
    );

    const { agent, ...restConfig } = (conversation.config ?? {}) as any;

    this.eventBus.emit(
      EmailArchived,
      createDomainEvent(EmailArchived, conversation.id, {
        conversationId: conversation.id,
        userId: conversation.userId,
        userContent,
        agentBinding: {
          agentId: agent ?? AgentIds.REACT,
          config: restConfig,
        },
      } satisfies EmailArchivedPayload),
    );

    return { conversationId: conversation.id };
  }

  private buildArchivePrompt(
    email: EmailEntity,
    contentOrCached: string | CachedReference,
  ): string {
    const fromDisplay = email.fromName
      ? `${email.fromName} <${email.from}>`
      : email.from;

    if (typeof contentOrCached === 'string') {
      return `使用 document_archive 技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容：\n${contentOrCached}`;
    }

    return `使用 document_archive 技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }
}

// ── EmailArchived (event handler / Saga) ───────────────────
// Cross-aggregate orchestration: activate conversation + start chat.
// This is the Saga pattern — event handler dispatching commands.

@eventHandler(EmailArchived)
export class EmailArchivedHandler {
  constructor(
    @inject(ConversationService)
    private readonly conversationService: ConversationService,
    @inject(CommandBus)
    private readonly commandBus: CommandBus,
  ) {}

  async handle(event: { payload: EmailArchivedPayload }): Promise<void> {
    const { conversationId, userId, userContent } = event.payload;

    const session = await this.conversationService.acquireChat(conversationId);
    if (!session) {
      throw new Error(`Failed to acquire session for ${conversationId}`);
    }

    await this.commandBus.execute(
      new ConversationActivateCommand(conversationId, userId),
    );

    await this.commandBus.execute(
      new StartChatCommand(conversationId, {
        role: Role.USER,
        content: userContent,
      }),
    );
  }
}
