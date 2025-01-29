import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';

@controller('/api/graph')
export class GraphController {
  @inject()
  pg?: DataSource = undefined;

  @api('/all')
  async getAllGraphs(_req: Request, res: Response) {
    const repo = this.pg!.getRepository(GraphEntity);
    const data = await repo.find();

    return res.json({ data });
  }

  @api('/detail/:graphId')
  async getGraphDetail(req: Request, res: Response) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graphId = Number(req.params.graphId);
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    const nodeRepo = this.pg!.getRepository(NodeEntity);
    const nodes = await nodeRepo.findBy({
      graphId,
    });

    return res.json({
      data: {
        ...graph,
        nodes,
      },
    });
  }
}
