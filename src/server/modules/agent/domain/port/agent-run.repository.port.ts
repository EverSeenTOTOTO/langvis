import type { AgentRun } from '@/shared/types/entities';

export interface AgentRunRepositoryPort {
  save(agentRun: AgentRun): Promise<AgentRun>;

  findById(runId: string): Promise<AgentRun | null>;

  findByIds(runIds: string[]): Promise<AgentRun[]>;

  /** 所有非终态 run（initialized/running）——启动清扫用。 */
  findNonTerminal(): Promise<AgentRun[]>;

  update(runId: string, partial: Partial<AgentRun>): Promise<AgentRun | null>;
}
