import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { NodeService } from '../service/NodeService';

@singleton()
@controller('/api/node')
export class NodeController {
  constructor(@inject(NodeService) private nodeService?: NodeService) {}

  @api('/add', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const node = await this.nodeService!.create(req.body);

    return res.json({ data: node });
  }

  @api('/del/:nodeId', { method: 'delete' })
  async deleteNode(req: Request, res: Response) {
    const nodeId = req.params.nodeId;
    const result = await this.nodeService!.delete(nodeId);

    if (result.affected === 0) {
      throw new Error(`Failed to delete Node with ID ${nodeId}`);
    }

    return res.json({ data: nodeId });
  }

  @api('/edit/:nodeId', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const nodeId = req.params.nodeId;
    const node = await this.nodeService!.update({ id: nodeId, ...req.body });

    return res.json({ data: node });
  }

  @api('/get/:nodeId', { method: 'get' })
  async getNode(req: Request, res: Response) {
    const nodeId = req.params.nodeId;
    const node = await this.nodeService!.findById(nodeId);

    if (!node) throw new Error(`Node ${nodeId} not found`);

    return res.json({ data: node });
  }
}
