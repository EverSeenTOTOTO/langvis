import { GraphCategory } from '@/shared/entities/Graph';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';

@injectable()
@controller('/api/nodemeta')
export class NodeMetaController {
  constructor(@inject(DataSource) private pg?: DataSource) {}

  @api('/get/:graphCategory')
  async getAllNodeTypes(req: Request, res: Response) {
    const repo = this.pg!.getRepository(NodeMetaEntity);
    const graphCategory = req.params.graphCategory as GraphCategory;
    const all = await repo.find();
    const data = all.filter(each =>
      each.supportCategories.includes(graphCategory),
    );

    return res.json({ data });
  }
}
