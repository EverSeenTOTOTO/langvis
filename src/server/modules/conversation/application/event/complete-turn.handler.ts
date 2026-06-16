import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;
    await this.convService.persistPendingMessage(
      conversationId,
      messageId,
      agentRunId,
    );
    const chat = this.convService.completeTurn(conversationId, messageId);
    if (chat) {
      this.sessionManager.syncInfrastructure(chat);
      chat.clearEvents();
    }
    this.sessionManager.finalizeRun(conversationId, messageId);
  }
}
