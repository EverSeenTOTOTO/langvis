import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { EdgeService } from '../service/EdgeService';

@singleton()
@controller('/api/edge')
export class EdgeController {
  constructor(@inject(EdgeService) private edgeService?: EdgeService) {}

  @api('/create', { method: 'post' })
  async createEdge(req: Request, res: Response) {
    const edge = await this.edgeService!.create(req.body);

    res.json({ data: edge });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteEdge(req: Request, res: Response) {
    const edgeId = req.params.id;
    const edge = await this.edgeService!.findById(edgeId);

    if (!edge) throw new Error(`Edge ${edgeId}not found`);

    await this.edgeService!.delete(edgeId);

    res.json({ data: req.params.id });
  }
}
