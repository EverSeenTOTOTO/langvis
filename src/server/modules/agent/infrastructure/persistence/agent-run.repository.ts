import type { AgentRun } from '@/shared/types/entities';
import type { AgentRunRepositoryPort } from '../../domain/port/agent-run.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { AgentRunEntity } from '@/shared/entities/AgentRun';
import { In } from 'typeorm';
import { inject, singleton } from 'tsyringe';

@singleton()
export class AgentRunRepository implements AgentRunRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async save(agentRun: AgentRun): Promise<AgentRun> {
    const repo = this.db.getRepository(AgentRunEntity);
    return await repo.save(agentRun as AgentRunEntity);
  }

  async findById(runId: string): Promise<AgentRun | null> {
    const repo = this.db.getRepository(AgentRunEntity);
    return await repo.findOneBy({ id: runId });
  }

  async findByIds(runIds: string[]): Promise<AgentRun[]> {
    if (runIds.length === 0) return [];
    const repo = this.db.getRepository(AgentRunEntity);
    return await repo.find({ where: { id: In(runIds) } });
  }

  async findNonTerminal(): Promise<AgentRun[]> {
    const repo = this.db.getRepository(AgentRunEntity);
    return await repo.find({
      where: { status: In(['initialized', 'running']) },
    });
  }

  async update(
    runId: string,
    partial: Partial<AgentRun>,
  ): Promise<AgentRun | null> {
    const repo = this.db.getRepository(AgentRunEntity);
    const entity = await repo.findOneBy({ id: runId });
    if (!entity) return null;
    Object.assign(entity, partial);
    return await repo.save(entity);
  }
}
