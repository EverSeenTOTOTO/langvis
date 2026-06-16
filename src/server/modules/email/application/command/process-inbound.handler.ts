import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import type { InboundEmailResult } from '../../domain/port/email.repository.port';
import { EmailService } from '../service/email.service';
import { ProcessInboundCommand } from '../../contracts';

@commandHandler(ProcessInboundCommand)
export class ProcessInboundHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
  ) {}

  async execute(command: ProcessInboundCommand): Promise<InboundEmailResult> {
    return this.emailService.processInbound(command.rawEmail);
  }
}
