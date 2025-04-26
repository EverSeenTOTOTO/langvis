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
    const node = await this.nodeService!.create(req.body);

    return res.json({ data: node });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    const nodeId = req.params.id;
    const node = await this.nodeService!.findById(nodeId);

    if (!node) throw new Error(`Node ${nodeId} not found`);

    await this.nodeService!.delete(nodeId);

    return res.json({ data: nodeId });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const nodeId = req.params.id;
    const node = await this.nodeService!.update({ id: nodeId, ...req.body });

    return res.json({ data: node });
  }
}
