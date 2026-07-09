/**
 * Agent 运行事件 + 传输帧。
 *
 * RunEvent — 领域层：表达 agent 执行过程中的一切事实。
 * 不区分 "领域事件" vs "流式数据" — 都是 agent 执行过程的消息，
 * 是否持久化是外部（应用层）的选择，不是内部标记。
 *
 * EnrichedEvent — 应用层：RunEvent + 执行元数据 (runId, at)。
 * 由 AgentRun.record() 在推送时注入。
 *
 * SSEFrame — 传输层：服务端 fold 后的投影帧 run_view + SSE 通道控制帧。
 * 不再透传原始 EnrichedEvent——客户端按 run_view 整包渲染。
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
  | { type: 'audio'; filePath: string; voice?: string }
  | { type: 'loop_usage'; used: number; total: number }
  | { type: 'hook'; hookId: string; summary: string; data?: unknown };

// ─── 应用层富化 ───

/**
 * RunEvent + 执行元数据。
 * AgentRun 在推送时注入 runId / at。
 */
export type EnrichedEvent = RunEvent & {
  runId: string;
  at: number;
};

/** 一次 hook 生效的投影记录（RunView.hooks / run_view.hooks 的元素）。 */
export interface HookRecord {
  hookId: string;
  summary: string;
  data?: unknown;
}

// ─── 传输帧 ───

/**
 * SSE 通道传输的完整帧。
 *
 * 投影帧 run_view = 服务端 fold 后的整包 RunView（实时 / 重连）。
 * 控制帧 = SSE 通道自身的状态事件 + 用量遥测。
 * 不再透传原始 EnrichedEvent 业务帧——客户端是纯渲染者。
 */
export type SSEFrame =
  | { type: 'connected' }
  | { type: 'session_replaced' }
  | {
      type: 'run_view';
      messageId: string;
      runId: string;
      content: string;
      steps: ReActStep[];
      status: RunStatus;
      awaitingInput: AwaitingInputProjection | null;
      processSummary: string | null;
      audio: { filePath: string; voice?: string } | null;
      hooks: HookRecord[];
    }
  // 上下文用量控制帧：conversation_usage 是会话层基线（全员可见，conv 自算直发）；
  // loop_usage 是 per-run 事实（见 RunEvent），conv 桥接时翻译为此控制帧下发（不带 at/messageId）。
  | { type: 'conversation_usage'; used: number; total: number }
  | { type: 'loop_usage'; runId: string; used: number; total: number };
