import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';
import { NodeService } from '../service/NodeService';

@singleton()
@controller('/api/graph')
export class GraphController {
  constructor(
    @inject(DataSource) private pg?: DataSource,
    @inject(GraphService) private graphService?: GraphService,
    @inject(NodeService) private nodeService?: NodeService,
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
    const nodes = await nodeRepo.findBy({
      graphId,
    });
    const nodeDtos = nodes.map(n => this.nodeService!.createNodeDTOFromDB(n));

    this.graphService!.initGraph(req.session!.id, {
      nodes: nodeDtos,
    });

    return res.json({
      data: {
        ...graph,
        nodes: nodeDtos.map(each => this.nodeService!.toClientNode(each)),
      },
    });
  }
}
