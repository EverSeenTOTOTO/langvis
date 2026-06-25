import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { EmailService } from '../service/email.service';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
  EmailArchived,
  type EmailArchivedPayload,
} from '../../contracts';
import { EmailNotFoundError } from '../../domain/errors';

@commandHandler(ArchiveEmailCommand)
export class ArchiveEmailHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
    @inject(ProviderService)
    private readonly providerService: ProviderService,
    @inject(EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ArchiveEmailCommand): Promise<ArchiveEmailResult> {
    const { emailId, userId } = command;

    const email = await this.emailService.getById(emailId);
    if (!email) {
      throw new EmailNotFoundError(emailId);
    }

    await this.emailService.updateStatus(emailId, 'archived');

    // Create the conversation synchronously so its id can be returned to the
    // caller (the client opens a new tab straight to this conversation). The
    // heavier work — caching the body and starting the agent run — is fired via
    // the EmailArchived event after we return.
    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.convRepo.create(
      `归档邮件: ${email.subject}`,
      userId,
      {
        model: { modelId: defaultModel?.id },
      },
      null,
      'Email Archive',
    );

    this.eventBus.dispatch(
      EmailArchived,
      createDomainEvent(EmailArchived, emailId, {
        userId,
        emailId,
        conversationId: conversation.id,
        emailSubject: email.subject,
        emailContent: email.content,
        emailFrom: email.from,
        emailFromName: email.fromName,
        emailSentAt: email.sentAt.toISOString(),
      } satisfies EmailArchivedPayload),
    );

    return { emailId, conversationId: conversation.id };
  }
}
