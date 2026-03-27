import { InjectTokens } from '@/shared/constants';
import { EmailEntity } from '@/shared/entities/Email';
import { generateId } from '@/shared/utils';
import { inject } from 'tsyringe';
import {
  Between,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
  type FindOptionsWhere,
  DataSource,
} from 'typeorm';
import { service } from '../decorator/service';
import Logger from '../utils/logger';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import type { simpleParser as SimpleParserFn } from 'mailparser';

export interface EmailListParams {
  from?: string;
  subject?: string;
  startDate?: string;
  endDate?: string;
  status?: 'unarchived' | 'archived';
  page?: number;
  pageSize?: number;
}

export interface EmailListResponse {
  items: EmailEntity[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateEmailData {
  messageId: string;
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  sentAt: Date;
  receivedAt: Date;
  content: string;
  attachmentCount?: number;
  attachmentNames?: string[];
  raw?: Record<string, unknown>;
}

export interface InboundEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

@service()
export class EmailService {
  private readonly logger = Logger.child({ source: 'EmailService' });

  constructor(
    @inject(InjectTokens.PG) private readonly dataSource: DataSource,
  ) {}

  private get repository() {
    return this.dataSource.getRepository(EmailEntity);
  }

  async list(params: EmailListParams): Promise<EmailListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: FindOptionsWhere<EmailEntity> = {};

    if (params.from) {
      where.from = Like(`%${params.from}%`);
    }

    if (params.subject) {
      where.subject = Like(`%${params.subject}%`);
    }

    if (params.startDate || params.endDate) {
      const start = params.startDate ? new Date(params.startDate) : undefined;
      const end = params.endDate ? new Date(params.endDate) : undefined;

      if (start && end) {
        where.sentAt = Between(start, end);
      } else if (start) {
        where.sentAt = MoreThanOrEqual(start);
      } else if (end) {
        where.sentAt = LessThanOrEqual(end);
      }
    }

    if (params.status) {
      where.status = params.status;
    }

    const [items, total] = await this.repository.findAndCount({
      where,
      order: { sentAt: 'DESC' },
      skip,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  async getById(id: string): Promise<EmailEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async getByMessageId(messageId: string): Promise<EmailEntity | null> {
    return this.repository.findOneBy({ messageId });
  }

  async existsByMessageId(messageId: string): Promise<boolean> {
    const count = await this.repository.count({ where: { messageId } });
    return count > 0;
  }

  async archive(
    data: CreateEmailData,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      this.logger.info(`Checking if email exists: ${data.messageId}`);
      const exists = await this.existsByMessageId(data.messageId);
      if (exists) {
        return { success: true };
      }

      const attachmentNames = this.extractAttachmentNames(data.raw);
      this.logger.info(
        `Creating email record: from=${data.from}, to=${data.to}, subject=${data.subject}`,
      );

      const email = this.repository.create({
        id: generateId('mail'),
        messageId: data.messageId,
        from: data.from,
        fromName: data.fromName || null,
        to: data.to,
        subject: data.subject,
        sentAt: data.sentAt,
        receivedAt: data.receivedAt,
        createdAt: new Date(),
        content: data.content,
        attachmentCount: data.attachmentCount ?? 0,
        attachmentNames:
          attachmentNames.length > 0 ? attachmentNames : undefined,
        metadata: data.raw ? { raw: data.raw } : undefined,
      });

      await this.repository.save(email);

      this.logger.info(
        `Email saved successfully: id=${email.id}, messageId=${data.messageId}`,
      );
      return { success: true, id: email.id };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to archive email: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async updateStatus(
    id: string,
    status: 'unarchived' | 'archived',
  ): Promise<{ success: boolean }> {
    const email = await this.repository.findOneBy({ id });
    if (!email) {
      return { success: false };
    }

    email.status = status;
    if (status === 'archived') {
      email.archivedAt = new Date();
    }

    await this.repository.save(email);
    return { success: true };
  }

  private extractAttachmentNames(raw?: Record<string, unknown>): string[] {
    const names: string[] = [];
    if (!raw) return names;

    let i = 1;
    while (raw[`attachment-${i}`]) {
      names.push(raw[`attachment-${i}`] as string);
      i++;
    }
    return names;
  }

  async processInbound(rawEmail: string): Promise<InboundEmailResult> {
    const { simpleParser } = await import('mailparser');
    const parsed = await Promise.race([
      simpleParser(rawEmail, {
        maxHtmlLengthToParse: 10 * 1024 * 1024, // 10MB
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Email parsing timeout after 30s')),
          30000,
        ),
      ),
    ]);

    this.logger.info(
      `Email parsed: messageId=${parsed.messageId}, from=${parsed.from?.value?.[0]?.address}, subject=${parsed.subject}`,
    );

    const forwardedInfo = this.extractForwardedInfo(parsed);
    if (forwardedInfo) {
      this.logger.info(
        `Detected forwarded email: ${JSON.stringify(forwardedInfo)}`,
      );
    }

    const toAddress = Array.isArray(parsed.to)
      ? parsed.to[0]?.value?.[0]?.address
      : parsed.to?.value?.[0]?.address;

    const hasHtml = !!parsed.html;
    const hasText = !!parsed.text;
    this.logger.info(
      `Content type: html=${hasHtml}, text=${hasText}, attachments=${parsed.attachments?.length || 0}`,
    );

    const emailData: CreateEmailData = {
      messageId: parsed.messageId || '',
      from: parsed.from?.value?.[0]?.address || '',
      fromName: parsed.from?.value?.[0]?.name,
      to: toAddress || '',
      subject: parsed.subject || '',
      content: parsed.html ? sanitizeHtml(parsed.html) : parsed.text || '',
      sentAt: parsed.date || new Date(),
      receivedAt: new Date(),
      attachmentCount: parsed.attachments?.length || 0,
      attachmentNames: parsed.attachments
        ?.map(a => a.filename)
        .filter((n): n is string => Boolean(n)),
      raw: {
        headers: Object.fromEntries(parsed.headers),
        forwarded: forwardedInfo,
      },
    };

    return this.archive(emailData);
  }

  private extractForwardedInfo(
    parsed: Awaited<ReturnType<typeof SimpleParserFn>>,
  ): { originalFrom?: string; forwardedVia?: string } | undefined {
    const headers = parsed.headers;
    const fromAddress = parsed.from?.value?.[0]?.address;

    const resentFrom = headers.get('resent-from');
    if (resentFrom) {
      return {
        originalFrom: this.parseAddress(String(resentFrom)),
        forwardedVia: fromAddress?.split('@')[1],
      };
    }

    const xForwardedFor = headers.get('x-forwarded-for');
    if (xForwardedFor) {
      return {
        originalFrom: String(xForwardedFor),
        forwardedVia: fromAddress?.split('@')[1],
      };
    }

    return undefined;
  }

  private parseAddress(header: string): string {
    const match = header.match(/<([^>]+)>/) || header.match(/(\S+@\S+)/);
    return match ? match[1] : header;
  }
}
