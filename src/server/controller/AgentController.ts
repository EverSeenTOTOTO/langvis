import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { AgentService } from '../service/AgentService';

@singleton()
@controller('/api/agent')
export class AgentController {
  constructor(
    @inject(AgentService)
    private agentService: AgentService,
  ) {}

  @api('/', { method: 'get' })
  async getAllAgents(_req: Request, res: Response) {
    const agents = await this.agentService.getAllAgentInfo();
    return res.json(agents);
  }
}
