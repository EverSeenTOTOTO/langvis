import type { LlmPort } from './llm.port';

/**
 * ToolCallContext — 工具执行所需的上下文契约。
 *
 * 与 AgentRunContext 对称：Tool 依赖此 port 而非具体的 ToolCall 实体，
 * 以解耦"单例工具 × 每次 per-call 上下文"。事实（status/output）与
 * 编排（execute 生命周期）仍归 ToolCall 实体，本 port 只暴露工具实际用到的表面。
 */
export interface ToolCallContext {
  /** 本次工具调用的 id —— 用于 tool_progress 等事件的 callId */
  readonly callId: string;
  /** 经 cache 解析后的输入参数 */
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly workDir: string;
  readonly llm: LlmPort;
  /** HITL 关联键（AskUser 写 human_input:<runId>）。不进入 AgentRunContext */
  readonly runId: string;
}
