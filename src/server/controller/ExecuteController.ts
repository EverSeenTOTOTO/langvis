import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ExecuteService } from '../service/ExecuteService';

@singleton()
@controller('/api/execute')
export class ExecuteController {
  constructor(
    @inject(ExecuteService) private executeService?: ExecuteService,
  ) {}

  @api('/graph/:graphId')
  async run(req: Request, res: Response) {
    const graphId = req.params.graphId;

    await this.executeService!.runGraph(graphId);

    return res.json({ data: graphId });
  }
}
