import { inject } from 'tsyringe';
import { TurnCancellationRequested } from '@/server/modules/conversation/contracts';
import type { TurnCancellationRequestedPayload } from '@/server/modules/conversation/contracts';
import { eventHandler } from '@/server/decorator/handler';
import { ConversationService } from '@/server/modules/conversation/application/service/conversation.service';

@eventHandler(TurnCancellationRequested)
export class TurnCancellationRequestedHandler {
  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {}

  async handle(event: {
    aggregateId: string;
    payload: TurnCancellationRequestedPayload;
  }): Promise<void> {
    this.conversationService.cancelActiveRun(
      event.aggregateId,
      event.payload.messageId,
      event.payload.reason,
    );
  }
}
