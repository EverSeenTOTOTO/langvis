import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { CancelChatCommand } from '../../contracts';

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(command: CancelChatCommand): Promise<void> {
    const chat = this.convService.requestCancellation(
      command.conversationId,
      command.messageId,
      command.reason,
    );
    if (chat) {
      this.sessionManager.syncInfrastructure(chat);
      chat.clearEvents();
    }
  }
}
