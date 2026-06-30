/**
 * agent 域的事件契约——published language。
 *
 * agent 的 ReAct loop 在 append/compact 后自发 loop 用量（WorkingMemory.getContextUsage）：
 * 发 LoopUsageReported（**仅 runId**，agent 不感知 conversation），conv 侧按 runId 反查会话后
 * 转 SSE 控制帧。
 */

/** agent→conv：某 run 的 loop 层用量（每轮迭代自增；仅 runId）。 */
export const LoopUsageReported = 'loop_usage_reported';

export interface LoopUsageReportedPayload {
  runId: string;
  used: number;
  total: number;
}
