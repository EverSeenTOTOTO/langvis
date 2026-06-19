import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { SessionManager } from '../service/session-manager';
import { CancelChatCommand } from '../../contracts';
import { NoActiveRunError, SessionNotFoundError } from '../../domain/errors';

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(command: CancelChatCommand): Promise<void> {
    if (command.messageId) {
      if (
        !this.sessionManager.hasActiveRun(
          command.conversationId,
          command.messageId,
        )
      ) {
        throw new NoActiveRunError(command.messageId);
      }
      this.sessionManager.cancelActiveRun(
        command.conversationId,
        command.messageId,
        command.reason,
      );
    } else {
      if (!this.sessionManager.hasSession(command.conversationId)) {
        throw new SessionNotFoundError(command.conversationId);
      }
      this.sessionManager.cancelAllActiveRuns(
        command.conversationId,
        command.reason,
      );
    }
  }
}
