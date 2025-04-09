import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { EdgeService } from '../service/EdgeService';

@singleton()
@controller('/api/edge')
export class EdgeController {
  constructor(@inject(EdgeService) private edgeService?: EdgeService) {}

  @api('/connect', { method: 'post' })
  async connect(req: Request, res: Response) {
    const data = this.edgeService!.create(req.body);

    res.json({ data });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteEdge(req: Request, res: Response) {
    const id = req.params.id;

    const data = await this.edgeService!.delete(id);

    res.json({ data });
  }
}
