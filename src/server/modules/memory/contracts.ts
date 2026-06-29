/**
 * memory 域的事件契约——published language。
 *
 * Phase 1 重构后 memory 不再监听任何 conv 事件（压缩改为 conv 经 HistoryCompactionPort
 * 同步调用、会话层用量由 conv 自算），唯一对外事件是 loop 层用量的自报：
 * WorkingMemory（per-run）在 record/compact 时经 LoopUsagePublisher 发 LoopUsageReported
 * （**仅 runId**，memory 不感知 conversation），conv 侧按 runId 反查会话后转 SSE 控制帧。
 */

/** memory→conv：某 run 的 loop 层用量（每轮迭代自增；仅 runId）。 */
export const LoopUsageReported = 'loop_usage_reported';

export interface LoopUsageReportedPayload {
  runId: string;
  used: number;
  total: number;
}
