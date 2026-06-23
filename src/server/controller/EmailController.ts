import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, query, request, response } from '../decorator/param';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { EmailService } from '@/server/modules/email/application/service/email.service';
import { CommandBus } from '@/server/libs/ddd';
import {
  ArchiveEmailCommand,
  ProcessInboundCommand,
} from '@/server/modules/email/contracts';
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

    // raw 缺失校验在 ProcessInboundHandler（→ 400）；解析错误由 api 装饰器映射（→ 500）。
    const result = await this.commandBus.execute(
      new ProcessInboundCommand(emailBody.raw),
    );

    if (!result.success) {
      this.logger.error(`Archive failed: ${result.error}`);
      return res.status(500).json({ error: result.error });
    }

    this.logger.info(`Email archived successfully: id=${result.id}`);
    return res.status(200).json({ success: true, id: result.id });
  }

  @api('/archive/:id', { method: 'post' })
  async archive(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = await this.authService.getUserId(req);

    // EmailNotFoundError→404、其余→500 由 api 装饰器映射。
    const { conversationId } = await this.commandBus.execute(
      new ArchiveEmailCommand(id, userId),
    );

    return res.status(200).json({ conversationId });
  }
}
