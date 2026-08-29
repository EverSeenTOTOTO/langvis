import type { AgentRun } from '@/shared/types/entities';
import type { RunStatus } from '@/shared/types/agent';
import type { EnrichedEvent } from '@/shared/types/events';

/** 终态提交载荷——events 是 executor 的唯一权威 writer。 */
export interface RunCommitParams {
  events: EnrichedEvent[];
  status: RunStatus;
  completedAt: Date;
}

export interface AgentRunRepositoryPort {
  save(agentRun: AgentRun): Promise<AgentRun>;

  findById(runId: string): Promise<AgentRun | null>;

  findByIds(runIds: string[]): Promise<AgentRun[]>;

  /** 所有非终态 run（initialized/running）——启动清扫用。 */
  findNonTerminal(): Promise<AgentRun[]>;

  update(runId: string, partial: Partial<AgentRun>): Promise<AgentRun | null>;

  // 乐观锁原子提交终态（events + status + completedAt）：加载最新版本 → 合并 → save。
  // 版本不匹配抛 {@link AgentRunConcurrentModificationError}，由调用方重读重试。
  commit(runId: string, params: RunCommitParams): Promise<AgentRun | null>;

  // 乐观锁中途 checkpoint：只写 events，status/completedAt 不动（维持 running）。崩溃恢复投影靠这部分事件。
  // 版本不匹配抛 {@link AgentRunConcurrentModificationError}。
  checkpoint(runId: string, events: EnrichedEvent[]): Promise<AgentRun | null>;
}
