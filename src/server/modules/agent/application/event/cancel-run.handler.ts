import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { CancelRun, RunEvent } from '@/server/modules/conversation/contracts';
import type {
  CancelRunPayload,
  RunEventPayload,
} from '@/server/modules/conversation/contracts';
import { AgentRunExecutor } from '../service/agent-run-executor';
import { eventHandler } from '@/server/decorator/handler';

/**
 * CancelRunHandler —— conv 请求取消某 run（事件驱动，取代会话直接调 executor.cancel）。
 */
@eventHandler(CancelRun)
export class CancelRunHandler {
  constructor(
    @inject(AgentRunExecutor) private executor: AgentRunExecutor,
    @inject(EventBus) private eventBus: EventBus,
  ) {}

  async handle(event: DomainEvent<string, CancelRunPayload>): Promise<void> {
    const { runId, conversationId, messageId, reason } = event.payload;
    const cancelled = this.executor.cancel(runId, reason);
    if (cancelled) {
      this.eventBus.dispatch(
        RunEvent,
        createDomainEvent(RunEvent, runId, {
          conversationId,
          messageId,
          event: cancelled,
        } satisfies RunEventPayload),
      );
    }
  }
}
