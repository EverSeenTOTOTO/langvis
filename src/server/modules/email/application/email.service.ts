import { EmailEntity } from '@/shared/entities/Email';
import { generateId } from '@/shared/utils';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { sanitizeHtml } from '@/server/utils/sanitizeHtml';
import type { simpleParser as SimpleParserFn } from 'mailparser';
import { EMAIL_REPOSITORY } from '../email.di-tokens';
import type {
  CreateEmailData,
  EmailListParams,
  EmailListResponse,
  EmailRepositoryPort,
  InboundEmailResult,
} from '../domain/port/email.repository.port';

export type {
  EmailListParams,
  EmailListResponse,
  CreateEmailData,
  InboundEmailResult,
};

@service()
export class EmailService {
  private readonly logger = Logger.child({ source: 'EmailService' });

  constructor(
    @inject(EMAIL_REPOSITORY)
    private readonly repo: EmailRepositoryPort,
  ) {}

  async list(params: EmailListParams): Promise<EmailListResponse> {
    return this.repo.list(params);
  }

  async getById(id: string): Promise<EmailEntity | null> {
    return this.repo.getById(id);
  }

  async getByMessageId(messageId: string): Promise<EmailEntity | null> {
    return this.repo.getByMessageId(messageId);
  }

  async existsByMessageId(messageId: string): Promise<boolean> {
    return this.repo.existsByMessageId(messageId);
  }

  async archive(
    data: CreateEmailData,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      this.logger.info(`Checking if email exists: ${data.messageId}`);
      const exists = await this.repo.existsByMessageId(data.messageId);
      if (exists) {
        return { success: true };
      }

      const attachmentNames = this.extractAttachmentNames(data.raw);
      this.logger.info(
        `Creating email record: from=${data.from}, to=${data.to}, subject=${data.subject}`,
      );

      const email = new EmailEntity();
      email.id = generateId('mail');
      email.messageId = data.messageId;
      email.from = data.from;
      email.fromName = data.fromName || null;
      email.to = data.to;
      email.subject = data.subject;
      email.sentAt = data.sentAt;
      email.receivedAt = data.receivedAt;
      email.createdAt = new Date();
      email.content = data.content;
      email.attachmentCount = data.attachmentCount ?? 0;
      email.attachmentNames =
        attachmentNames.length > 0 ? attachmentNames : null;
      email.metadata = data.raw ? { raw: data.raw } : null;

      await this.repo.save(email);

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
    return this.repo.deleteById(id);
  }

  async updateStatus(
    id: string,
    status: 'unarchived' | 'archived',
  ): Promise<{ success: boolean }> {
    const ok = await this.repo.updateStatus(id, status);
    return { success: ok };
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
        maxHtmlLengthToParse: 10 * 1024 * 1024,
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

    const result = await this.archive(emailData);
    return {
      success: result.success,
      id: result.id,
      error: result.error,
    };
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
