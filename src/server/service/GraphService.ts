import { GraphEntity } from '@/shared/entities/Graph';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { EdgeService } from './EdgeService';
import { NodeService } from './NodeService';
import { pgInjectToken } from './pg';
import { SSEService } from './SSEService';

@singleton()
export class GraphService {
  constructor(
    @inject(NodeService) private nodeService?: NodeService,
    @inject(EdgeService) private edgeService?: EdgeService,
    @inject(pgInjectToken) private pg?: DataSource,
    @inject(SSEService) private sseService?: SSEService,
  ) {}

  findAll() {
    return this.pg!.getRepository(GraphEntity).find();
  }

  async findByGraphId(graphId: string) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const nodes = await this.nodeService!.findByGraphId(graphId);
    const edges = await this.edgeService!.findByGraphId(graphId);

    const data = { ...graph, nodes, edges };

    return data;
  }

  async runGraph(graphId: string) {
    const data = await this.findByGraphId(graphId);
    this.sseService!.sendMessage(`graph:${graphId}`, data);
  }
}
