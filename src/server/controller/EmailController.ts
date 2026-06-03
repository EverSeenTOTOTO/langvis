import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, query, request, response } from '../decorator/param';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { EmailService } from '@/server/modules/email/domain/email.service';
import { CommandBus } from '@/server/libs/ddd';
import { ArchiveEmailCommand } from '@/server/modules/email/contracts';
import { ListEmailsRequestDto } from '@/shared/dto/controller';
import Logger from '../utils/logger';

const INBOUND_SECRET = import.meta.env.VITE_INBOUND_SECRET || '';

interface InboundEmailBody {
  raw: string;
}

@controller('/api/emails')
export default class EmailController {
  private readonly logger = Logger.child({ source: 'EmailController' });

  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(CommandBus)
    private readonly commandBus: CommandBus,
    @inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @api('/')
  async list(@query() dto: ListEmailsRequestDto, @response() res: Response) {
    const result = await this.emailService.list({
      from: dto.from,
      subject: dto.subject,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: dto.status,
      page: dto.page,
      pageSize: dto.pageSize,
    });

    return res.json(result);
  }

  @api('/:id')
  async getById(@param('id') id: string, @response() res: Response) {
    const email = await this.emailService.getById(id);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    return res.json(email);
  }

  @api('/:id', { method: 'delete' })
  async delete(@param('id') id: string, @response() res: Response) {
    const result = await this.emailService.delete(id);

    if (!result) {
      return res.status(404).json({ error: 'Email not found' });
    }

    return res.json({ success: true });
  }

  @api('/inbound', { method: 'post' })
  async handleInbound(
    @body() emailBody: InboundEmailBody,
    @request() req: Request,
    @response() res: Response,
  ) {
    const secret = req.headers['x-inbound-secret'];

    if (!INBOUND_SECRET || secret !== INBOUND_SECRET) {
      this.logger.warn('Invalid or missing inbound secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!emailBody.raw) {
      this.logger.warn('Missing raw email content');
      return res.status(400).json({ error: 'Missing raw email content' });
    }

    try {
      const result = await this.emailService.processInbound(emailBody.raw);

      if (!result.success) {
        this.logger.error(`Archive failed: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }

      this.logger.info(`Email archived successfully: id=${result.id}`);
      return res.status(200).json({ success: true, id: result.id });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process inbound email: ${errorMsg}`);
      return res.status(500).json({ error: errorMsg });
    }
  }

  @api('/archive/:id', { method: 'post' })
  async archive(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = await this.authService.getUserId(req);

    try {
      const { conversationId } = await this.commandBus.execute(
        new ArchiveEmailCommand(id, userId),
      );

      return res.status(200).json({ conversationId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to archive email: ${errorMsg}`);

      if (errorMsg.includes('not found')) {
        return res.status(404).json({ error: errorMsg });
      }

      return res.status(500).json({ error: errorMsg });
    }
  }
}
