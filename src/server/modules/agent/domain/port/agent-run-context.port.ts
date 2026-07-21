import type { RunConfigVO } from '../model/run-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { CachePort } from './cache.port';
import type { AuthorizationPort } from './authorization.port';
import type { HookPlan } from '../model/hook';
import type { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';

/** 工具执行能力；executor 持有，显式注入 loop。 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => AsyncGenerator<RunEvent, string, void>;

/** 解析出的 ReAct 动作。loop 权威解析一次后挂到 ctx.pendingAction，pre-action hook 直接读、不再各自 parse。 */
export interface ParsedAction {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RunConfigVO;
  readonly runId: string;
  readonly workDir: string;
  /** 会话句柄：授权 grant 按 conversationId 持久（workDir 文件），跨 run 复用。 */
  readonly conversationId: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  /** 横切授权能力（Principal(conversationId)×Action×Resource，session 持久 + HITL）。 */
  readonly auth: AuthorizationPort;
  messages: ListMonad<LlmMessage>;
  readonly base: number;
  readonly hooks?: HookPlan;
  /**
   * 本 tick 权威解析出的动作：loop 在 LLM 产出后、pre-action hook 前解析并赋值，
   * hook 据此拦截而不各自 re-parse（cumulative-budget/stuck 共用）。
   * parse 失败时本 tick 不进 pre-action、此字段为上一 tick 残值——hook 不应在
   * parse 失败路径被调用，故无须清空。
   */
  pendingAction?: ParsedAction;
  /** 是否允许 HITL。conv run = true；子 agent = false。ToolCall 经 ToolCallContext 透传给工具。 */
  readonly interactive: boolean;
}
