import type { EnrichedEvent } from '@/shared/types/events';

/**
 * Agent run 的领域事件契约——agent 拥有并外发，conv（及其它订阅方）按需 import。
 * Token 是纯字符串常量，EventBus 按值匹配；移动定义只改 import 来源，不影响接线。
 */

/** agent→conv：run 开始（conv 据此 registerRun + persistAgentRunId）。 */
export const RunStarted = 'run_started';
/** agent→conv：run 的每条富化事件（conv 据此 SSE 桥接 + 缓冲）。 */
export const RunEvent = 'run_event';
/** conv→agent：请求取消某 run（agent 据此 executor.cancel，取消事件经 RunEvent 回流）。 */
export const CancelRun = 'cancel_run';
/** agent→conv：run 终态（conv 据此 completeTurn 投影/持久化/压缩）。 */
export const RunCompleted = 'run_completed';

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
