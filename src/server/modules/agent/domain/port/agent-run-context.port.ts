import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from './llm.port';
import type { CachePort } from './cache.port';
import type { ContextPort } from '@/server/modules/memory/domain/port/context.port';

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RuntimeConfigVO;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  readonly memory: ContextPort;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
