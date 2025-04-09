import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';
import { NodeService } from '../service/NodeService';
import { EdgeEntity } from '@/shared/entities/Edge';

@singleton()
@controller('/api/node')
export class NodeController {
  constructor(
    @inject(DataSource) private pg?: DataSource,
    @inject(NodeService) private nodeService?: NodeService,
    @inject(GraphService) private graphService?: GraphService,
  ) {}

  @api('/create', { method: 'post' })
  async createNode(req: Request, res: Response) {
    const node = this.nodeService!.createFromClient(req.body);
    const dbNode = await this.pg!.getRepository(NodeEntity).save(
      this.nodeService!.toDatabase(node),
    );

    this.nodeService!.updateFromDB(node, dbNode);
    this.graphService!.addNode(req.session!.id, node);

    return res.json({ data: this.nodeService!.toClient(node) });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteNode(req: Request, res: Response) {
    const id = req.params.id;
    await this.pg!.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.getRepository(NodeEntity).delete(id);

      const { edges } = this.graphService!.deleteNode(req.session!.id, id);

      await Promise.all(
        edges.map(e =>
          transactionalEntityManager.getRepository(EdgeEntity).delete(e.id),
        ),
      );
    });
    return res.json({ data: id });
  }

  @api('/update/:id', { method: 'post' })
  async updateNode(req: Request, res: Response) {
    const id = req.params.id;

    const { node, edges } = this.graphService!.updateNode(
      req.session!.id,
      req.body,
    );

    this.nodeService!.updateFromClient(node, req.body);

    await this.pg!.transaction(async transactionalEntityManager => {
      await transactionalEntityManager
        .createQueryBuilder()
        .update(NodeEntity)
        .set(this.nodeService!.toDatabase(node))
        .where('id = :id', { id })
        .execute();
      await Promise.all(
        edges.map(e =>
          transactionalEntityManager.getRepository(EdgeEntity).delete(e.id),
        ),
      );
    });

    return res.json({ data: this.nodeService!.toClient(node) });
  }
}
