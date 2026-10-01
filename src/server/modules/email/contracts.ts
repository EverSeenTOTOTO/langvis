import { Command } from '@nestjs/cqrs';
import type { InboundEmailResult } from './domain/port/email.repository.port';

export class ProcessInboundCommand extends Command<InboundEmailResult> {
  constructor(readonly rawEmail: string) {
    super();
  }
}

export class ArchiveEmailCommand extends Command<ArchiveEmailResult> {
  constructor(
    readonly emailId: string,
    readonly userId: string,
  ) {
    super();
  }
}

export interface ArchiveEmailResult {
  emailId: string;
  conversationId: string;
}

/** email 内部：邮件已归档（据此编排 compose→activate→start）。 */
export class EmailArchived {
  readonly type = 'email_archived' as const;
  readonly occurredAt = Date.now();

  constructor(
    readonly aggregateId: string,
    readonly payload: EmailArchivedPayload,
  ) {}
}

export interface EmailArchivedPayload {
  userId: string;
  emailId: string;
  conversationId: string;
  emailSubject: string;
  emailContent: string;
  emailFrom: string;
  emailFromName: string | null;
  emailSentAt: string;
}
