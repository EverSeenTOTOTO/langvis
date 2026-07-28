import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { SessionManager } from '../service/session-manager';
import { CancelChatCommand } from '../../contracts';
import { NoActiveRunError, SessionNotFoundError } from '../../domain/errors';
import { TraceContext } from '@/server/middleware/trace-context';

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async execute(cmd: CancelChatCommand): Promise<void> {
    if (TraceContext.get())
      TraceContext.update({ conversationId: cmd.conversationId });
    if (cmd.messageId) {
      if (
        !this.sessionManager.hasActiveRun(cmd.conversationId, cmd.messageId)
      ) {
        throw new NoActiveRunError(cmd.messageId);
      }
      this.sessionManager.cancelActiveRun(
        cmd.conversationId,
        cmd.messageId,
        cmd.reason,
      );
    } else {
      if (!this.sessionManager.hasSession(cmd.conversationId)) {
        throw new SessionNotFoundError(cmd.conversationId);
      }
      await this.sessionManager.cancelAllActiveRuns(
        cmd.conversationId,
        cmd.reason,
      );
    }
  }
}
