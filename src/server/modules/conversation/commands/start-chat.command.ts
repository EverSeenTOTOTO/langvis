import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { Command } from '@/server/libs/ddd';

export class StartChatCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    },
    readonly assistantId?: string,
  ) {
    super();
  }
}
