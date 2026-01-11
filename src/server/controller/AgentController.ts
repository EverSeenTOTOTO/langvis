import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { request, response } from '../decorator/param';
import { AgentService } from '../service/AgentService';

@controller('/api/agent')
export default class AgentController {
  constructor(
    @inject(AgentService)
    private agentService: AgentService,
  ) {}

  @api('/', { method: 'get' })
  async getAllAgents(@request() _req: Request, @response() res: Response) {
    const agents = await this.agentService.getAllAgentInfo();
    return res.json(agents);
  }
}
