import { Inject } from '@nestjs/common';
import { EventBus, EventsHandler } from '@nestjs/cqrs';
import { CancelRun, RunEvent } from '@/server/modules/agent/contracts';
import type { RunEventPayload } from '@/server/modules/agent/contracts';
import { AgentRunExecutor } from '../service/agent-run-executor';

// CancelRunHandler —— conv 请求取消某 run（事件驱动）。conv 侧 SessionManager 仍从旧
// bus dispatch，LegacyBridgeModule 转发器把 'cancel_run' 桥到本订阅（Phase 4 统一）。
@EventsHandler(CancelRun)
export class CancelRunHandler {
  constructor(
    @Inject(AgentRunExecutor) private executor: AgentRunExecutor,
    private eventBus: EventBus,
  ) {}

  async handle(event: CancelRun): Promise<void> {
    const { runId, conversationId, messageId, reason } = event.payload;
    const cancelled = this.executor.cancel(runId, reason);
    if (cancelled) {
      this.eventBus.publish(
        new RunEvent(runId, {
          conversationId,
          messageId,
          event: cancelled,
        } satisfies RunEventPayload),
      );
    }
  }
}
