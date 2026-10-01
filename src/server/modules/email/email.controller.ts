import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { EmailService } from './application/service/email.service';
import { CommandBus } from '@nestjs/cqrs';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import { ArchiveEmailCommand, ProcessInboundCommand } from './contracts';
import { ListEmailsRequestDto } from '@/shared/dto/controller';
import { DtoValidationPipe } from '@/server/pipes/dto-validation.pipe';
import { Public } from '@/server/guards/auth.guard';
import Logger from '@/server/utils/logger';

const INBOUND_SECRET = process.env.VITE_INBOUND_SECRET || '';

// 常量时间比较：sha256 等长摘要再 timingSafeEqual——既不泄漏内容也不泄漏长度。
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

@Controller('emails')
export class EmailController {
  private readonly logger = Logger.child({ source: 'EmailController' });

  constructor(
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(CommandBus) private readonly commandBus: CommandBus,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get()
  async list(
    @Query(new DtoValidationPipe(ListEmailsRequestDto))
    dto: ListEmailsRequestDto,
  ) {
    return this.emailService.list({
      from: dto.from,
      subject: dto.subject,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: dto.status,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const email = await this.emailService.getById(id);
    if (!email) {
      throw new HttpException({ error: 'Email not found' }, 404);
    }
    return email;
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const result = await this.emailService.delete(id);
    if (!result) {
      throw new HttpException({ error: 'Email not found' }, 404);
    }
    return { success: true };
  }

  @Public()
  @Post('inbound')
  async handleInbound(
    @Body() emailBody: { raw?: string },
    @Req() req: Request,
  ) {
    const secret = String(req.headers['x-inbound-secret'] ?? '');

    if (!INBOUND_SECRET || !constantTimeEqual(secret, INBOUND_SECRET)) {
      this.logger.warn('Invalid or missing inbound secret');
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }

    // raw 缺失校验在 ProcessInboundHandler（→ 400）；解析错误由异常过滤器映射（→ 500）。
    const result = await this.commandBus.execute(
      new ProcessInboundCommand(emailBody.raw ?? ''),
    );

    if (!result.success) {
      this.logger.error(`Archive failed: ${result.error}`);
      throw new HttpException({ error: result.error }, 500);
    }

    this.logger.info(`Email archived successfully: id=${result.id}`);
    return { success: true, id: result.id };
  }

  @Post('archive/:id')
  async archive(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.authService.getUserId(req.headers.cookie ?? '');

    // EmailNotFoundError→404、其余→500 由异常过滤器映射。
    const { conversationId } = await this.commandBus.execute(
      new ArchiveEmailCommand(id, userId),
    );

    return { conversationId };
  }
}
