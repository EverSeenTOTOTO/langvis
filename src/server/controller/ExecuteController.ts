import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { GraphService } from '../service/GraphService';

@singleton()
@controller('/api/execute')
export class ExecuteController {
  constructor(@inject(GraphService) private graphService?: GraphService) {}

  @api('/graph/:graphId')
  async run(req: Request, res: Response) {
    const graphId = req.params.graphId;

    await this.graphService!.runGraph(graphId);

    return res.json({ data: graphId });
  }
}
