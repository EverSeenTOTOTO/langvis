import { EdgeEntity } from '@/shared/entities/Edge';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { EdgeService } from '../service/EdgeService';
import { GraphService } from '../service/GraphService';

@singleton()
@controller('/api/edge')
export class EdgeController {
  constructor(
    @inject(DataSource) private pg?: DataSource,
    @inject(GraphService) private graphService?: GraphService,
    @inject(EdgeService) private edgeService?: EdgeService,
  ) {}

  @api('/connect', { method: 'post' })
  async connect(req: Request, res: Response) {
    const edge = this.edgeService!.createFromClient(req.session!.id, req.body);
    const dbEdge = await this.pg!.getRepository(EdgeEntity).save(
      this.edgeService!.toDatabase(req.session!.id, edge),
    );

    this.edgeService!.updateFromDB(edge, dbEdge);
    this.graphService!.addEdge(req.session!.id, edge);

    res.json({
      data: this.edgeService!.toClient(req.session!.id, edge),
    });
  }

  @api('/delete/:id', { method: 'post' })
  async deleteEdge(req: Request, res: Response) {
    const id = req.params.id;

    await this.pg!.getRepository(EdgeEntity).delete(id);
    this.graphService!.deleteEdge(req.session!.id, id);

    res.json({
      data: id,
    });
  }
}
