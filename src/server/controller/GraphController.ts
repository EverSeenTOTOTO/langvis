import { GraphEntity } from '@/shared/entities/Graph';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';
import { InjectTokens } from '../utils';

@singleton()
@controller('/api/graph')
export class GraphController {
  constructor(
    @inject(InjectTokens.PG) private pg?: DataSource,
    @inject(GraphService) private graphService?: GraphService,
  ) {}

  @api('/add', { method: 'post' })
  async create(req: Request, res: Response) {
    const graph = await this.graphService!.create(req.body as GraphEntity);

    return res.json({ data: graph });
  }

  @api('/del/:graphId', { method: 'delete' })
  async delete(req: Request, res: Response) {
    const graphId = req.params.graphId;
    const result = await this.graphService!.delete(graphId);

    if (result.affected === 0) {
      throw new Error(`Failed to delete graph with ID ${graphId}`);
    }

    return res.json({ data: graphId });
  }

  @api('/edit/:graphId', { method: 'post' })
  async modify(req: Request, res: Response) {
    const graphId = req.params.graphId;
    const graph = req.body as GraphEntity;
    const result = await this.graphService!.update({
      ...graph,
      id: graphId,
    });

    return res.json({ data: result });
  }

  @api('/all')
  async queryAll(_req: Request, res: Response) {
    const repo = this.pg!.getRepository(GraphEntity);
    const data = await repo.find();

    return res.json({ data });
  }

  @api('/get/:graphId')
  async queryOne(req: Request, res: Response) {
    const graphId = req.params.graphId;

    const data = await this.graphService!.findById(graphId);

    return res.json({ data });
  }

  @api('/detail/:graphId')
  async queryDetail(req: Request, res: Response) {
    const graphId = req.params.graphId;

    const data = await this.graphService!.findDetailById(graphId);

    return res.json({ data });
  }
}
