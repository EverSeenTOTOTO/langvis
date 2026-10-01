import { Inject } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import type { InboundEmailResult } from '../../domain/port/email.repository.port';
import { EmailService } from '../service/email.service';
import { ProcessInboundCommand } from '../../contracts';
import { MissingRawEmailContentError } from '../../domain/errors';

@CommandHandler(ProcessInboundCommand)
export class ProcessInboundHandler {
  constructor(
    @Inject(EmailService)
    private readonly emailService: EmailService,
  ) {}

  async execute(command: ProcessInboundCommand): Promise<InboundEmailResult> {
    if (!command.rawEmail) {
      throw new MissingRawEmailContentError();
    }
    return this.emailService.processInbound(command.rawEmail);
  }
}
