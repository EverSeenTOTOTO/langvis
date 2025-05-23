import { GraphEntity } from '@/shared/entities/Graph';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';
import { pgInjectToken } from '../service/pg';

@singleton()
@controller('/api/graph')
export class GraphController {
  constructor(
    @inject(pgInjectToken) private pg?: DataSource,
    @inject(GraphService) private graphService?: GraphService,
  ) {}

  @api('/all')
  async getAllGraphs(_req: Request, res: Response) {
    const repo = this.pg!.getRepository(GraphEntity);
    const data = await repo.find();

    return res.json({ data });
  }

  @api('/get/:graphId')
  async getOne(req: Request, res: Response) {
    const graphId = req.params.graphId;

    const data = await this.graphService!.findByGraphId(graphId);

    return res.json({ data });
  }

  @api('/run/:graphId')
  async run(req: Request, res: Response) {
    const graphId = req.params.graphId;

    await this.graphService!.runGraph(graphId);

    return res.json({ data: graphId });
  }
}
