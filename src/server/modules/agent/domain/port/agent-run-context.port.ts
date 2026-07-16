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

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RunConfigVO;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  /** 横切授权能力（Principal(runId)×Action×Resource，per-run 缓存 + HITL）。 */
  readonly auth: AuthorizationPort;
  messages: ListMonad<LlmMessage>;
  readonly base: number;
  readonly hooks?: HookPlan;
  /** 是否允许 HITL。conv run = true；子 agent = false。ToolCall 经 ToolCallContext 透传给工具。 */
  readonly interactive: boolean;
}
