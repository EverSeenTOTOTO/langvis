import { EdgeEntity } from '@/shared/entities/Edge';
import { ClientEdge } from '@/shared/types';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { pgInjectToken } from './pg';

@singleton()
export class EdgeService {
  constructor(@inject(pgInjectToken) private pg?: DataSource) {}

  async create(edge: ClientEdge) {
    return this.pg!.getRepository(EdgeEntity).save({
      ...edge,
      graphId: edge.data!.graphId,
    });
  }

  delete(id: string) {
    return this.pg!.getRepository(EdgeEntity).delete(id);
  }

  findByGraphId(graphId: string) {
    return this.pg!.getRepository(EdgeEntity).findBy({
      graphId,
    });
  }

  findByNodeId(nodeId: string) {
    return this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.source = :nodeId', { nodeId })
      .orWhere('edge.target = :nodeId', { nodeId })
      .getMany();
  }

  findBySourceNodeId(nodeId: string) {
    return this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.source = :nodeId', { nodeId })
      .getMany();
  }

  findByTargetNodeId(nodeId: string) {
    return this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.target = :nodeId', { nodeId })
      .getMany();
  }
}
