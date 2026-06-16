import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { ConversationService } from '../service/conversation.service';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;
    await this.convService.persistPendingMessage(
      conversationId,
      messageId,
      agentRunId,
    );
    this.convService.completeTurn(conversationId, messageId);
    this.convService.finalizeRun(conversationId, messageId);
  }
}
