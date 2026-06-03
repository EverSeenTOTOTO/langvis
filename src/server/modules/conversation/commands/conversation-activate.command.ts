import { Command } from '@/server/libs/ddd';

export class ConversationActivateCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userId: string,
  ) {
    super();
  }
}
