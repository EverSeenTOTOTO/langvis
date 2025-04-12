import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { NodeService } from '../service/NodeService';

@singleton()
@controller('/api/node')
export class NodeController {
  constructor(@inject(NodeService) private nodeService?: NodeService) {}

  @api('/create', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const data = await this.nodeService!.create(req.body);

    return res.json({ data });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    await this.nodeService!.delete(req.params.id);

    return res.json({ data: req.params.id });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const id = req.params.id;
    const data = await this.nodeService!.update({ id, ...req.body });

    return res.json({ data });
  }
}
