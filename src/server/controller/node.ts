import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';

@controller('/api/node')
export class NodeController {
  @inject()
  pg?: DataSource = undefined;

  @api('/create', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const node = await this.pg!.getRepository(NodeEntity).save(req.body);
    return res.json({ data: node });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    const id = req.params.id;
    await this.pg!.getRepository(NodeEntity).delete(id);
    return res.json({ data: id });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const id = req.params.id;

    await this.pg!.createQueryBuilder()
      .update(NodeEntity)
      .set(req.body)
      .where('id = :id', { id })
      .execute();

    return res.json({ data: id });
  }
}
