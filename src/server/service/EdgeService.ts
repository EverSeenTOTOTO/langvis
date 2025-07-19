import { EdgeEntity, EdgeMetaName } from '@/shared/entities/Edge';
import { ClientEdge, InstrinicEdge } from '@/shared/types';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Bezier } from '../core/edges/Bezier';
import { type NodeService } from './NodeService';
import { InjectTokens } from '../utils';

@singleton()
export class EdgeService {
  constructor(
    @inject(InjectTokens.PG) private pg?: DataSource,
    @inject(InjectTokens.NODE_SERVICE) private nodeService?: NodeService,
  ) {}

  async create(edge: ClientEdge) {
    const existingEdge = await this.findBySourceAndTarget(
      edge.source,
      edge.target,
    );

    if (existingEdge) {
      const source = await this.nodeService!.findById(edge.source);
      const target = await this.nodeService!.findById(edge.target);

      throw new Error(
        `Edge with <${source.data?.name}.source> and <${target.data?.name}.target> already exists`,
      );
    }

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

  async findBySourceAndTarget(sourceId: string, targetId: string) {
    const result = await this.pg!.getRepository(EdgeEntity)
      .createQueryBuilder('edge')
      .where('edge.source = :sourceId AND edge.target = :targetId', {
        sourceId,
        targetId,
      })
      .getOne();

    return result ? this.toClient(result) : null;
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
