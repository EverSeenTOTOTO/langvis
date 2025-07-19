import { GraphEntity } from '@/shared/entities/Graph';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { EdgeService } from './EdgeService';
import { NodeService } from './NodeService';
import { InjectTokens } from '../utils';

@singleton()
export class GraphService {
  constructor(
    @inject(NodeService) private nodeService?: NodeService,
    @inject(EdgeService) private edgeService?: EdgeService,
    @inject(InjectTokens.PG) private pg?: DataSource,
  ) {}

  create(graph: GraphEntity) {
    return this.pg!.getRepository(GraphEntity).save(graph);
  }

  async delete(graphId: string) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graph = await graphRepo.findOneBy({ id: graphId });

    if (!graph) throw new Error(`Graph ${graphId} not found`);

    return graphRepo.delete(graphId);
  }

  async update(graph: GraphEntity) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const existingGraph = await graphRepo.findOneBy({ id: graph.id });

    if (!existingGraph) throw new Error(`Graph ${graph.id} not found`);

    return graphRepo.save(graph);
  }

  findAll() {
    return this.pg!.getRepository(GraphEntity).find();
  }

  findById(graphId: string) {
    return this.pg!.getRepository(GraphEntity).findOneBy({ id: graphId });
  }

  async findDetailById(graphId: string) {
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
}
