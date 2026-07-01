import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { CommandBus, EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { Conversation } from '@/shared/types/entities';
import { EmailService } from '../service/email.service';
import { CreateConversationCommand } from '@/server/modules/conversation/contracts';
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
    @inject(CommandBus)
    private readonly commandBus: CommandBus,
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
    // the EmailArchived event after we return. 建会话走 conversation 的命令(公开 API),
    // 不再跨 BC 直连 conversation 的 repository。
    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.commandBus.execute<Conversation>(
      new CreateConversationCommand(
        `归档邮件: ${email.subject}`,
        userId,
        { model: { modelId: defaultModel?.id } },
        null,
        'Email Archive',
      ),
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
