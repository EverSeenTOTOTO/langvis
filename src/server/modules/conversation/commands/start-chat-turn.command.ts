import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { Command } from '@/server/libs/ddd';

export class StartChatTurnCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userId: string,
    readonly systemPrompt: string,
    readonly context: string | undefined,
    readonly userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    },
    readonly assistantId: string | undefined,
  ) {
    super();
  }
}
