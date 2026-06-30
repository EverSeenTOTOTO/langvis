import type { LlmPort } from '@/server/libs/ports/llm/llm.port';

/**
 * ToolCallContext —— 与 AgentRunContext 对称：Tool 依赖此 port 而非具体 ToolCall 实体，
 * 解耦"单例工具 × 每次 per-call 上下文"。事实/编排归 ToolCall，本 port 只暴露工具实际用到的表面。
 */
export interface ToolCallContext {
  /** 用于 tool_progress 等事件的 callId */
  readonly callId: string;
  /** 经 cache 解析后的输入参数 */
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly workDir: string;
  readonly llm: LlmPort;
  /** chat/chatContent 类工具调用 LLM 时传入（无绑定层后由调用方提供）。 */
  readonly chatModelId: string | undefined;
  /** HITL 关联键（AskUser 写 human_input:<runId>），不进入 AgentRunContext。 */
  readonly runId: string;
  /** 运行时配置快照。供工具读取用户默认值（如 TTS voice/modelId），避免把这些内部参数暴露给模型。 */
  readonly runtimeConfig: Record<string, unknown>;
}
