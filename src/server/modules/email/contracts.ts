import { Command } from '@/server/libs/ddd';
import type { AgentBinding } from '@/shared/types/agent';

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
}

export const EmailArchived = 'email_archived';

export interface EmailArchivedPayload {
  userId: string;
  emailId: string;
  emailSubject: string;
  emailContent: string;
  emailFrom: string;
  emailFromName: string | null;
  emailSentAt: string;
  agentBinding: AgentBinding;
}
