import type { RunConfigVO } from '../model/run-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { CachePort } from './cache.port';
import type { HookPlan } from '../model/hook';
import type { ListMonad } from '@/server/libs/list';
import type { LlmMessage } from '@/shared/types/entities';

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RunConfigVO;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  messages: ListMonad<LlmMessage>;
  readonly base: number;
  readonly hooks?: HookPlan;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
