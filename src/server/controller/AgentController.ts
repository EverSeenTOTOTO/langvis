import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { request, response } from '../decorator/param';
import { AgentService } from '../modules/agent/application/service/agent.service';
import { SkillService } from '../modules/agent/application/service/skill.service';

@controller('/api/agent')
export default class AgentController {
  constructor(
    @inject(AgentService) private readonly agentService: AgentService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {}

  @api('/', { method: 'get' })
  async getConfig(@request() _req: Request, @response() res: Response) {
    // 收敛单一 agent 后返回聚合后的对话配置 schema（各域 ConfigFragment 平铺）。
    return res.json(this.agentService.getConfigSchema());
  }

  @api('/skills', { method: 'get' })
  async listSkills(@response() res: Response) {
    return res.json(await this.skillService.getAllSkillInfo());
  }
}
