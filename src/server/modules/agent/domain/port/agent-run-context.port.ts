import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { CachePort } from './cache.port';
import type { WorkingMemory } from '../model/working-memory';
import type { HookPlan } from '../model/hook';

export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RuntimeConfigVO;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;
  /** per-run loop 工作记忆（瞬态成员）：按需压缩 / 取迭代上下文 / 记录步骤 / 折叠过程摘要。 */
  readonly workingMemory: WorkingMemory;
  /** hook 管道（按相位索引）：loop 在边界依次 apply；省略=空管道（无 hook）。 */
  readonly hooks?: HookPlan;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
