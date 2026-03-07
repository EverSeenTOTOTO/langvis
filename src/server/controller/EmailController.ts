import { ListEmailsRequestDto } from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, query, request, response } from '../decorator/param';
import { EmailService } from '../service/EmailService';
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
  ) {}

  @api('/')
  async list(@query() dto: ListEmailsRequestDto, @response() res: Response) {
    const result = await this.emailService.list({
      from: dto.from,
      subject: dto.subject,
      startDate: dto.startDate,
      endDate: dto.endDate,
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
    this.logger.info('Received inbound email request');

    const secret = req.headers['x-inbound-secret'];

    if (!INBOUND_SECRET || secret !== INBOUND_SECRET) {
      this.logger.warn('Invalid or missing inbound secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!emailBody.raw) {
      this.logger.warn('Missing raw email content');
      return res.status(400).json({ error: 'Missing raw email content' });
    }

    this.logger.info(`Raw email size: ${emailBody.raw.length} bytes`);

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
}

