import type { AgentRun } from '@/shared/types/entities';
import type {
  AgentRunRepositoryPort,
  RunCommitParams,
} from '../../domain/port/agent-run.repository.port';
import { AgentRunConcurrentModificationError } from '../../domain/errors';
import type { EnrichedEvent } from '@/shared/types/events';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { AgentRunEntity } from '@/shared/entities/AgentRun';
import {
  In,
  OptimisticLockVersionMismatchError,
  type Repository,
} from 'typeorm';
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
    return await this.persist(runId, repo, entity);
  }

  async commit(
    runId: string,
    params: RunCommitParams,
  ): Promise<AgentRun | null> {
    const repo = this.db.getRepository(AgentRunEntity);
    const entity = await repo.findOneBy({ id: runId });
    if (!entity) return null;
    entity.events = params.events;
    entity.status = params.status;
    entity.completedAt = params.completedAt;
    return await this.persist(runId, repo, entity);
  }

  async checkpoint(
    runId: string,
    events: EnrichedEvent[],
  ): Promise<AgentRun | null> {
    const repo = this.db.getRepository(AgentRunEntity);
    const entity = await repo.findOneBy({ id: runId });
    if (!entity) return null;
    entity.events = events;
    return await this.persist(runId, repo, entity);
  }

  /** @Version 冲突（OptimisticLockVersionMismatchError）包装成领域错误，不再静默覆盖。 */
  private async persist(
    runId: string,
    repo: Repository<AgentRunEntity>,
    entity: AgentRunEntity,
  ): Promise<AgentRun> {
    try {
      return await repo.save(entity);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new AgentRunConcurrentModificationError(runId);
      }
      throw err;
    }
  }
}
