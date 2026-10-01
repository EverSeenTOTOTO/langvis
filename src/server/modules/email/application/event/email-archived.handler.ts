import { Inject } from '@nestjs/common';
import { CommandBus, EventsHandler } from '@nestjs/cqrs';
import {
  ConversationActivateCommand,
  StartChatCommand,
} from '@/server/modules/conversation/contracts';
import { Role } from '@/shared/entities/Message';
import { EmailArchived } from '../../contracts';
import { EmailService } from '../service/email.service';

// EmailArchived 的薄调度器：仅编排 compose → activate → start，提示词与 body 缓存留在 EmailService。
@EventsHandler(EmailArchived)
export class EmailArchivedHandler {
  constructor(
    @Inject(EmailService)
    private readonly emailService: EmailService,
    @Inject(CommandBus)
    private readonly commandBus: CommandBus,
  ) {}

  async handle(event: EmailArchived): Promise<void> {
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
