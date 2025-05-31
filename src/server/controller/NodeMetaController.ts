import { NodeMetaName } from '@/shared/entities/NodeMeta';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { NodeMetaService } from '../service/NodeMetaService';

@singleton()
@controller('/api/nodemeta')
export class NodeMetaController {
  constructor(
    @inject(NodeMetaService) private nodemetaService?: NodeMetaService,
  ) {}

  @api('/add', { method: 'post' })
  async create(req: Request, res: Response) {
    const result = await this.nodemetaService!.createNodeMeta(req.body);

    return res.json({ data: result });
  }

  @api('/del/:name', { method: 'delete' })
  async delete(req: Request, res: Response) {
    const name = req.params.name as NodeMetaName;
    const result = await this.nodemetaService!.deleteNodeMeta(name);

    if (result.affected === 0) {
      throw new Error(`Failed to delete NodeMeta with name ${name}`);
    }

    return res.json({ data: name });
  }

  @api('/all')
  async queryAll(_req: Request, res: Response) {
    const data = await this.nodemetaService!.getAllNodeMeta();

    return res.json({ data });
  }

  @api('/query')
  async query(req: Request, res: Response) {
    const category = req.query?.category;

    if (typeof category !== 'string') {
      throw new Error("Invalid param 'category' for query nodemeta");
    }

    const data = await this.nodemetaService!.getByCategory(category);

    return res.json({ data });
  }

  @api('/edit/:name', { method: 'post' })
  async modify(req: Request, res: Response) {
    const name = req.params.name as NodeMetaName;
    const updated = await this.nodemetaService!.updateNodeMeta(name, req.body);

    return res.json({ data: updated });
  }
}
