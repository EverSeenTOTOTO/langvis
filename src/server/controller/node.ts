import { NodeEntity } from '@/shared/entities/Node';
import { ServerNode } from '@/shared/types';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { Graph } from '../core/graph';
import { mapNodeDTOFromClient } from '../core/mapDTO';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';

@controller('/api/node')
export class NodeController {
  @inject()
  pg?: DataSource = undefined;

  @inject()
  graphs?: Map<string, Graph> = undefined;

  @api('/create', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const graph = this.graphs!.get(req.session!.id);
    const node = mapNodeDTOFromClient(req.body, graph!);

    const dbNode = await this.pg!.getRepository(NodeEntity).save(
      node.toDatabase(),
    );
    node.fromDatabase(dbNode);
    graph!.addNode(node);

    return res.json({ data: node.toClient() });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    const id = req.params.id;

    await this.pg!.getRepository(NodeEntity).delete(id);
    this.graphs!.get(req.session!.id)?.deleteNode(id);

    return res.json({ data: id });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const id = req.params.id;
    const graph = this.graphs!.get(req.session!.id);
    const node = graph?.getNode(id) as ServerNode;

    if (!node) {
      throw new Error(`Node ${id} not found in server side`);
    }

    node.fromClient(req.body, graph!);
    await this.pg!.createQueryBuilder()
      .update(NodeEntity)
      .set(node.toDatabase())
      .where('id = :id', { id })
      .execute();

    return res.json({ data: node.toClient() });
  }
}
