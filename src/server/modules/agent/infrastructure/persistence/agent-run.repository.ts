import type { AgentRun } from '@/shared/types/entities';
import type {
  AgentRunRepositoryPort,
  RunCommitParams,
} from '../../domain/port/agent-run.repository.port';
import { AgentRunConcurrentModificationError } from '../../domain/errors';
import type { EnrichedEvent } from '@/shared/types/events';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { AgentRunEntity } from '@/shared/entities/AgentRun';
import { Inject } from '@nestjs/common';
import {
  In,
  OptimisticLockVersionMismatchError,
  type Repository,
} from 'typeorm';

export class AgentRunRepository implements AgentRunRepositoryPort {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async save(agentRun: AgentRun): Promise<AgentRun> {
    const repo = this.db.getRepository(AgentRunEntity);
    // 纯 INSERT：save() 对手写主键先 SELECT 探测存在再写（远程 DB 双往返）；
    // 新 run 主键必不冲突，insert 一次往返完成。QueryDeepPartial 对 jsonb 列类型不兼容，double-cast。
    await repo.insert(agentRun as unknown as Parameters<typeof repo.insert>[0]);
    return agentRun;
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
