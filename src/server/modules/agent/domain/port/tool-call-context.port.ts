import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { ConversationConfig } from '@/server/libs/config';
import type { AuthorizationPort } from './authorization.port';
import type { AgentRun } from '../model/agent-run.entity';

// ToolCallContext —— 与 AgentRunContext 对称
export interface ToolCallContext {
  /** 用于 tool_progress 等事件的 callId */
  readonly callId: string;
  /** 经 cache 解析后的输入参数 */
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly workDir: string;
  /** 会话句柄：授权 grant 按 conversationId 持久（workDir 文件），跨 run 复用。 */
  readonly conversationId: string;
  readonly llm: LlmPort;
  /** 横切授权能力：越界工具经此过授权门（session 持久 + HITL）。 */
  readonly auth: AuthorizationPort;
  /** 承载 HITL 协调态的聚合实例（AskUser 读写待输入/已提交，不经 executor 反查）。 */
  readonly run: AgentRun;
  /** 是否允许 HITL。conv run = true；子 agent = false（无 HTTP 提交入口，AskUser 会 fail-fast）。 */
  readonly interactive: boolean;
  /** 运行时配置快照。供工具读取用户默认值（如 TTS voice/modelId），避免把这些内部参数暴露给模型。 */
  readonly runtimeConfig: ConversationConfig;
}
