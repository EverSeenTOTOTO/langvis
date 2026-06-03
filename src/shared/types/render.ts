/**
 * 投影值对象 — 从 Agent 领域事件实时沉淀到 Message 的结构化记录。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/03-conversation.md
 */

import type { RunStatus } from './agent';

/**
 * 工具调用记录 — 从 tool_result / tool_error 事件投影而来。
 *
 * 与 ToolCallTimeline 的区别：
 * - 无 pending 状态（记录只在工具完成时追加）
 * - 实时投影写入，不需要 buildToolTimeline() 重建
 */
export type ToolCallRecord = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: 'completed' | 'failed';
  output?: unknown;
  error?: string;
  duration: number;
  startedAt: number;
  completedAt: number;
};

/**
 * ReAct 推理步骤 — 将 thought + action + observation 绑定为一个原子单元。
 * ChatAgent 场景下 steps 为空，仅累积 content。
 */
export interface ReActStep {
  thought: string;
  action?: {
    callId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  };
  observation?: string;
  startedAt: number;
  completedAt?: number;
}

/**
 * PendingMessage 快照 — SSE 断线重连时的状态恢复依据。
 * 由 Conversation 聚合根内的 PendingMessage 实体产出。
 */
export interface PendingMessageSnapshot {
  messageId: string;
  content: string;
  steps: ReActStep[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

/**
 * AgentRun 运行时快照 — 用于断线重连。
 * 前端请求快照 → 恢复渲染状态 → 重新订阅 SSE 实时流。
 *
 * @deprecated 由 PendingMessageSnapshot 替代，保留用于过渡期兼容。
 */
export type RunSnapshot = {
  runId: string;
  messageId: string;
  status: RunStatus;
  content: string;
  toolCallRecords: ToolCallRecord[];
  thoughts: string[];
};
