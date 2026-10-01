import type { EnrichedEvent } from '@/shared/types/events';

// Agent run 领域事件契约——agent 拥有并外发，conv 及其它订阅方按需 import。
// Run* 为 @nestjs/cqrs 事件类；CancelRun 暂留字符串走旧 EventBus（Phase 4 统一）。

/** agent→conv：run 开始（conv 据此 registerRun + persistAgentRunId）。 */
export class RunStarted {
  readonly type = 'run_started' as const;
  readonly occurredAt = Date.now();

  constructor(
    readonly aggregateId: string,
    readonly payload: RunStartedPayload,
  ) {}
}

/** agent→conv：run 的每条富化事件（conv 据此 SSE 桥接 + 缓冲）。 */
export class RunEvent {
  readonly type = 'run_event' as const;
  readonly occurredAt = Date.now();

  constructor(
    readonly aggregateId: string,
    readonly payload: RunEventPayload,
  ) {}
}

/** conv→agent：请求取消某 run（agent 据此 executor.cancel，取消事件经 RunEvent 回流）。 */
export class CancelRun {
  readonly type = 'cancel_run' as const;
  readonly occurredAt = Date.now();

  constructor(
    readonly aggregateId: string,
    readonly payload: CancelRunPayload,
  ) {}
}

/** agent→conv：run 终态（conv 据此 completeTurn 投影/持久化/压缩）。 */
export class RunCompleted {
  readonly type = 'run_completed' as const;
  readonly occurredAt = Date.now();

  constructor(
    readonly aggregateId: string,
    readonly payload: RunCompletedPayload,
  ) {}
}

export interface RunStartedPayload {
  conversationId: string;
  messageId: string;
  runId: string;
}

export interface RunEventPayload {
  conversationId: string;
  messageId: string;
  event: EnrichedEvent;
}

export interface CancelRunPayload {
  runId: string;
  conversationId: string;
  messageId: string;
  reason: string;
}

export interface RunCompletedPayload {
  conversationId: string;
  messageId: string;
  agentRunId: string;
}
