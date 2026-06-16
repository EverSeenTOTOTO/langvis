import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ConversationService } from '../service/conversation.service';
import { CancelChatCommand } from '../../contracts';

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(ConversationService)
    private service: ConversationService,
  ) {}

  async execute(command: CancelChatCommand): Promise<void> {
    this.service.requestCancellation(
      command.conversationId,
      command.messageId,
      command.reason,
    );
  }
}
