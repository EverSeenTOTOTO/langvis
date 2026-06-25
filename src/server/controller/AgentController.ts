import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { request, response } from '../decorator/param';
import { AgentService } from '../modules/agent/application/service/agent.service';

@controller('/api/agent')
export default class AgentController {
  constructor(
    @inject(AgentService) private readonly agentService: AgentService,
  ) {}

  @api('/', { method: 'get' })
  async getConfig(@request() _req: Request, @response() res: Response) {
    // 收敛单一 agent 后返回全局配置（由 AgentService 提供，不再 import 松散常量）。
    return res.json(this.agentService.getDescriptor());
  }
}
