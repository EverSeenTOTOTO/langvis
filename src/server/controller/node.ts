import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';
import { GraphService } from '../service/GraphService';
import { NodeService } from '../service/NodeService';

@controller('/api/node')
export class NodeController {
  @inject()
  pg?: DataSource = undefined;

  @inject()
  nodeService?: NodeService = undefined;

  @inject()
  graphService?: GraphService = undefined;

  @api('/create', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const node = this.nodeService!.createNodeDTOFromClient(req.body);
    const dbNode = await this.pg!.getRepository(NodeEntity).save(
      node.toDatabase(),
    );

    this.nodeService!.updateNodeDTOFromDB(node, dbNode);
    this.graphService!.addNode(req.session!.id, node);

    return res.json({ data: node.toClient() });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    const id = req.params.id;

    await this.pg!.getRepository(NodeEntity).delete(id);
    this.graphService!.deleteNode(req.session!.id, id);

    return res.json({ data: id });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const id = req.params.id;
    const node = this.graphService!.updateNode(req.session!.id, req.body);

    await this.pg!.createQueryBuilder()
      .update(NodeEntity)
      .set(node.toDatabase())
      .where('id = :id', { id })
      .execute();

    return res.json({ data: node.toClient() });
  }
}
