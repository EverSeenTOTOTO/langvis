import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { EdgeService } from '../service/EdgeService';

@singleton()
@controller('/api/edge')
export class EdgeController {
  constructor(@inject(EdgeService) private edgeService?: EdgeService) {}

  @api('/add', { method: 'post' })
  async create(req: Request, res: Response) {
    const result = await this.edgeService!.create(req.body);

    return res.json({ data: result });
  }

  @api('/del/:edgeId', { method: 'delete' })
  async delete(req: Request, res: Response) {
    const edgeId = req.params.edgeId;
    const result = await this.edgeService!.delete(edgeId);

    if (result.affected === 0) {
      throw new Error(`Failed to delete Edge with ID ${edgeId}`);
    }

    return res.json({ data: edgeId });
  }

  @api('/edit/:edgeId', { method: 'post' })
  async modify(req: Request, res: Response) {
    const edgeId = req.params.edgeId;
    const updated = await this.edgeService!.update({ id: edgeId, ...req.body });

    return res.json({ data: updated });
  }

  @api('/get/:edgeId')
  async queryOne(req: Request, res: Response) {
    const edgeId = req.params.edgeId;
    const data = await this.edgeService!.findById(edgeId);

    return res.json({ data });
  }
}
