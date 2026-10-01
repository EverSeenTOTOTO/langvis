import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EmailService } from './application/service/email.service';
import { EmailController } from './email.controller';
import { EmailRepository } from './infrastructure/persistence/email.repository';
import { EMAIL_REPOSITORY } from './email.di-tokens';
import { ProcessInboundHandler } from './application/command/process-inbound.handler';
import { ArchiveEmailHandler } from './application/command/archive-email.handler';
import { EmailArchivedHandler } from './application/event/email-archived.handler';

@Module({
  imports: [CqrsModule],
  controllers: [EmailController],
  providers: [
    EmailRepository,
    { provide: EMAIL_REPOSITORY, useExisting: EmailRepository },
    EmailService,
    ProcessInboundHandler,
    ArchiveEmailHandler,
    EmailArchivedHandler,
  ],
})
export class EmailModule {}
