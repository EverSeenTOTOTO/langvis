import { inject } from 'tsyringe';
import { TurnCancellationRequested } from '@/server/modules/conversation/contracts';
import type { TurnCancellationRequestedPayload } from '@/server/modules/conversation/contracts';
import { eventHandler } from '@/server/decorator/handler';
import { SessionManager } from '@/server/modules/conversation/application/service/session-manager';

@eventHandler(TurnCancellationRequested)
export class TurnCancellationRequestedHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
  ) {}

  async handle(event: {
    aggregateId: string;
    payload: TurnCancellationRequestedPayload;
  }): Promise<void> {
    this.sessionManager.cancelActiveRun(
      event.aggregateId,
      event.payload.messageId,
      event.payload.reason,
    );
  }
}
