import { Command } from '@/server/libs/ddd';

export class ProcessInboundCommand extends Command {
  constructor(readonly rawEmail: string) {
    super();
  }
}

export class ArchiveEmailCommand extends Command {
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

export const EmailArchived = 'email_archived';

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
