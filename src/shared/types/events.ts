/**
 * Agent 领域事件、流式数据、传输帧。
 *
 * AgentEvent — 领域事件，表达业务状态变更。
 * StreamChunk — 流式数据通道（token 级别）。
 * SSEFrame — SSE 传输帧，由应用层 enrich seq/at/messageId。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/04-event-system.md
 */

// ─── 领域事件 ───

/**
 * Agent 运行过程中的业务状态变更。
 *
 * 与旧版 AgentEvent 的区别：
 * - runId 替代 messageId（领域标识 vs 关联标识）
 * - 不含 seq/at（传输层概念，由 AgentRun.emit() 注入）
 * - 移除 stream（独立为 StreamChunk）
 * - 移除 context_usage（独立为 ContextUsageMeta）
 * - 9 变体（旧版 11 变体）
 */
export type AgentEvent =
  | { type: 'start'; runId: string }
  | { type: 'thought'; runId: string; content: string }
  | {
      type: 'tool_call';
      runId: string;
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
    }
  | { type: 'tool_progress'; runId: string; callId: string; data: unknown }
  | {
      type: 'tool_result';
      runId: string;
      callId: string;
      toolName: string;
      output: unknown;
    }
  | {
      type: 'tool_error';
      runId: string;
      callId: string;
      toolName: string;
      error: string;
    }
  | { type: 'final'; runId: string }
  | { type: 'cancelled'; runId: string; reason: string }
  | { type: 'error'; runId: string; error: string };

// ─── 流式数据 ───

/**
 * 独立的流式通道。
 * 与 AgentEvent 分离，因为 token 流式输出不是业务状态变更。
 */
export type StreamChunk = {
  type: 'text_chunk';
  runId: string;
  content: string;
};

// ─── 上下文用量 ───

/**
 * 上下文窗口用量元信息。
 * 不是独立领域事件，作为轻量 SSE 帧发送。
 */
export type ContextUsageMeta = {
  used: number;
  total: number;
  reason:
    | 'llm_generation_completed'
    | 'tool_result_appended'
    | 'context_compressed'
    | 'turn_completed';
};

// ─── 传输帧 ───

/**
 * SSE 通道传输的完整帧。
 *
 * 应用层在推送时 enrich：
 * - seq：序列号，由 AgentRun.emit() 分配
 * - at：时间戳，由 AgentRun.emit() 分配
 * - messageId：关联标识，从 run.messageId 获取
 */
export type SSEFrame =
  | (AgentEvent & { seq: number; at: number; messageId: string })
  | (StreamChunk & { seq: number; at: number; messageId: string })
  | {
      type: 'context_usage';
      messageId: string;
      seq: number;
      at: number;
      used: number;
      total: number;
      reason: ContextUsageMeta['reason'];
    }
  | { type: 'connected' }
  | { type: 'session_error'; error: string };
