import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { CachePort } from './cache.port';
import type { WorkingMemory } from '../model/working-memory';
import type { EventBus } from '@/server/libs/ddd';

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
  /** loop 用量自报（append/compact 后发 LoopUsageReported）。 */
  readonly eventBus: EventBus;

  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
