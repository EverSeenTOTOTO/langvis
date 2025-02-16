import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';
import { NodeService } from '../service/NodeService';
import { EdgeEntity } from '@/shared/entities/Edge';
import { EdgeService } from '../service/EdgeService';

@singleton()
@controller('/api/graph')
export class GraphController {
  constructor(
    @inject(DataSource) private pg?: DataSource,
    @inject(GraphService) private graphService?: GraphService,
    @inject(NodeService) private nodeService?: NodeService,
    @inject(EdgeService) private edgeService?: EdgeService,
  ) {}

  @api('/all')
  async getAllGraphs(_req: Request, res: Response) {
    const repo = this.pg!.getRepository(GraphEntity);
    const data = await repo.find();

    return res.json({ data });
  }

  @api('/init/:graphId')
  async initGraph(req: Request, res: Response) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graphId = req.params.graphId;
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    const nodeRepo = this.pg!.getRepository(NodeEntity);
    const dbNodes = await nodeRepo.findBy({
      graphId,
    });
    const nodes = dbNodes.map(n => this.nodeService!.createFromDB(n));
    const edgeRepo = this.pg!.getRepository(EdgeEntity);
    const dbEdges = await edgeRepo.findBy({
      graphId,
    });

    this.graphService!.initGraph(req.session!.id, { nodes });

    const edges = dbEdges.map(e =>
      this.edgeService!.createFromDB(req.session!.id, e),
    );

    edges.forEach(e => this.graphService!.addEdge(req.session!.id, e));

    return res.json({
      data: {
        ...graph,
        nodes: nodes.map(each => this.nodeService!.toClient(each)),
        edges: edges.map(each =>
          this.edgeService!.toClient(req.session!.id, each),
        ),
      },
    });
  }
}
