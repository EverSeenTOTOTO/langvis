import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from './llm.port';
import type { CachePort } from './cache.port';
import type { MemoryPort } from '@/server/modules/memory/domain/port/memory.port';

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RuntimeConfigVO;
  readonly agentId: string;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  readonly memory: MemoryPort;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
