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

// EmailArchived 的薄调度器：仅编排 compose → activate → start，提示词与 body 缓存留在 EmailService。
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
