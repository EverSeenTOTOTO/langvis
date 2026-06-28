import type { LlmPort } from '@/server/libs/ports/llm/llm.port';

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
  /** 本轮 chat 模型 id——chat/chatContent 类工具调用 LLM 时传入（无绑定层后由调用方提供）。 */
  readonly chatModelId: string | undefined;
  /** HITL 关联键（AskUser 写 human_input:<runId>）。不进入 AgentRunContext */
  readonly runId: string;
  /** 本次会话的运行时配置（RuntimeConfigVO.runtimeConfig 的解析快照）。
   *  供工具读取用户配置的默认值（如 TTS 的 voice/modelId），避免把这些内部参数
   *  暴露给模型（模型看不到 config）。 */
  readonly runtimeConfig: Record<string, unknown>;
}
