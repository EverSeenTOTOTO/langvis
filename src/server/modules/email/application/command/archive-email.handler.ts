import { AgentIds } from '@/shared/constants';
import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { EmailService } from '../service/email.service';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
  EmailArchived,
  type EmailArchivedPayload,
} from '../../contracts';

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

    this.eventBus.dispatch(
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
