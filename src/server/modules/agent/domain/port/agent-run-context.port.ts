import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { CachePort } from './cache.port';
import type { LoopMemoryPort } from '@/server/modules/memory';

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RuntimeConfigVO;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  /** memory 的同步 Customer-Supplier 端口：申请迭代上下文 / 记录步骤 / 折叠过程摘要（runId 索引）。 */
  readonly loopMemory: LoopMemoryPort;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
