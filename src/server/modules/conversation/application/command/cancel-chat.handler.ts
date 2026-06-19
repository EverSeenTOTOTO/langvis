import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { SessionManager } from '../service/session-manager';
import { CancelChatCommand } from '../../contracts';

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(command: CancelChatCommand): Promise<void> {
    if (command.messageId) {
      this.sessionManager.cancelActiveRun(
        command.conversationId,
        command.messageId,
        command.reason,
      );
    } else {
      this.sessionManager.cancelAllActiveRuns(
        command.conversationId,
        command.reason,
      );
    }
  }
}
