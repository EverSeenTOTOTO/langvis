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
  conversationId: string;
}

export const EmailArchived = 'email_archived';

export interface EmailArchivedPayload {
  conversationId: string;
  userId: string;
  userContent: string;
  agentBinding: AgentBinding;
}
