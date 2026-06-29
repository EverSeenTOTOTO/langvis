/**
 * Agent 运行事件 + 传输帧。
 *
 * RunEvent — 领域层：表达 agent 执行过程中的一切事实。
 * 不区分 "领域事件" vs "流式数据" — 都是 agent 执行过程的消息，
 * 是否持久化是外部（应用层）的选择，不是内部标记。
 *
 * EnrichedEvent — 应用层：RunEvent + 执行元数据 (runId, seq, at)。
 * 由 AgentRun.enrichAndEmit() 在推送时注入。
 *
 * SSEFrame — 传输层：EnrichedEvent + 关联标识 (messageId)，
 * 以及 SSE 通道自身的控制帧。
 */

import { RunStatus } from './agent';
import { AwaitingInputProjection, ReActStep } from './render';

// ─── 领域事件 ───

/**
 * Agent 运行过程中的全部事实。
 * 纯业务语义，不含传输/执行元数据。
 */
export type RunEvent =
  | { type: 'start' }
  | { type: 'text_chunk'; content: string }
  | { type: 'thought'; content: string }
  | {
      type: 'tool_call';
      callId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
    }
  | { type: 'tool_progress'; callId: string; data: unknown }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      output: unknown;
    }
  | {
      type: 'tool_error';
      callId: string;
      toolName: string;
      error: string;
    }
  | { type: 'final' }
  | { type: 'cancelled'; reason: string }
  | { type: 'error'; error: string }
  | { type: 'process_summary'; summary: string }
  | { type: 'audio'; filePath: string; voice?: string };

// ─── 应用层富化 ───

/**
 * RunEvent + 执行元数据。
 * AgentRun 在推送时注入 runId / seq / at，
 * 保证每个事件有序、可溯源。
 */
export type EnrichedEvent = RunEvent & {
  runId: string;
  seq: number;
  at: number;
};

// ─── 传输帧 ───

/**
 * SSE 通道传输的完整帧。
 *
 * 业务帧 = EnrichedEvent + messageId (关联标识)
 * 控制帧 = SSE 通道自身的状态事件
 */
export type SSEFrame =
  | (EnrichedEvent & { messageId: string })
  | { type: 'connected' }
  | { type: 'session_replaced' }
  | { type: 'session_error'; error: string }
  | {
      type: 'state_snapshot';
      messageId: string;
      content: string;
      steps: ReActStep[];
      status: RunStatus;
      awaitingInput: AwaitingInputProjection | null;
    }
  // 上下文用量（memory 端到端拥有、经会话级控制帧下发，非 run 级 RunEvent）：
  // 会话层基线（全员可见）+ loop 层（per-run、runId 关联消息）。
  | { type: 'conversation_usage'; used: number; total: number }
  | { type: 'loop_usage'; runId: string; used: number; total: number };
