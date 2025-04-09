import { GraphEntity } from '@/shared/entities/Graph';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { EdgeService } from './EdgeService';
import { NodeService } from './NodeService';
import { pgInjectToken } from './pg';

@singleton()
export class GraphService {
  constructor(
    @inject(NodeService) private nodeService?: NodeService,
    @inject(EdgeService) private edgeService?: EdgeService,
    @inject(pgInjectToken) private pg?: DataSource,
  ) {}

  findAll() {
    return this.pg!.getRepository(GraphEntity).find();
  }

  async findByGraphId(graphId: string) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    const nodes = await this.nodeService!.findByGraphId(graphId);
    const edges = await this.edgeService!.findByGraphId(graphId);

    return {
      ...graph,
      nodes,
      edges,
    };
  }
}
