import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import { CommandBus } from '@/server/libs/ddd';
import {
  ConversationActivateCommand,
  StartChatCommand,
} from '@/server/modules/conversation/contracts';
import { Role } from '@/shared/entities/Message';
import { EmailArchived, type EmailArchivedPayload } from '../../contracts';
import { EmailService } from '../service/email.service';

/** Reaction to EmailArchived: hand the archived email to the summarization run.
 *  Stays a thin dispatcher — prompt building + body caching live in
 *  EmailService.composeArchivePrompt; this only sequences compose → activate → start. */
@eventHandler(EmailArchived)
export class EmailArchivedHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
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

    const userContent = await this.emailService.composeArchivePrompt({
      conversationId,
      subject: emailSubject,
      from: emailFrom,
      fromName: emailFromName,
      sentAt: emailSentAt,
      content: emailContent,
    });

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
}
