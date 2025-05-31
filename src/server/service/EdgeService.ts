import { EdgeEntity, EdgeMetaName } from '@/shared/entities/Edge';
import { ClientEdge, InstrinicEdge } from '@/shared/types';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { pgInjectToken } from './pg';
import { Bezier } from '../core/edges/Bezier';

@singleton()
export class EdgeService {
  constructor(@inject(pgInjectToken) private pg?: DataSource) {}

  async create(edge: ClientEdge) {
    const entity = this.toDatabase(edge);
    const result = await this.pg!.getRepository(EdgeEntity).save(entity);

    return this.toClient(result);
  }

  delete(id: string) {
    return this.pg!.getRepository(EdgeEntity).delete(id);
  }

  async update(edge: ClientEdge) {
    const repo = this.pg!.getRepository(EdgeEntity);
    const result = await repo.save({
      ...edge,
      graphId: edge.data!.graphId,
    });

    return this.toClient(result);
  }

  async findById(edgeId: string) {
    const result = await this.pg!.getRepository(EdgeEntity).findOneBy({
      id: edgeId,
    });

    if (!result) {
      throw new Error(`Edge with id ${edgeId} not found`);
    }

    return this.toClient(result);
  }

  async findByGraphId(graphId: string) {
    const result = await this.pg!.getRepository(EdgeEntity).findBy({
      graphId,
    });

    return result.map(edge => this.toClient(edge));
  }

  async findByNodeId(nodeId: string) {
    const result = await this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.source = :nodeId', { nodeId })
      .orWhere('edge.target = :nodeId', { nodeId })
      .getMany();

    return result.map(edge => this.toClient(edge));
  }

  async findBySourceNodeId(nodeId: string) {
    const result = await this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.source = :nodeId', { nodeId })
      .getMany();

    return result.map(edge => this.toClient(edge));
  }

  async findByTargetNodeId(nodeId: string) {
    const result = await this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.target = :nodeId', { nodeId })
      .getMany();

    return result.map(edge => this.toClient(edge));
  }

  toClient(edge: EdgeEntity) {
    switch (edge.type) {
      case EdgeMetaName.BEZIER:
        return Bezier.toClient(edge);
      default:
        throw new Error(
          `Failed to convert client edge: not implemented. Edge type: ${edge.type}`,
        );
    }
  }

  toDatabase(edge: ClientEdge) {
    switch (edge.type) {
      case EdgeMetaName.BEZIER:
        return Bezier.toDatabase(edge as InstrinicEdge['bezier']);
      default:
        throw new Error(
          `Failed to convert database edge: not implemented. Edge type: ${edge.type}`,
        );
    }
  }
}
