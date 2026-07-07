import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { param, request, response } from '../decorator/param';
import { QueryBus } from '@/server/libs/ddd';
import { AgentService } from '../modules/agent/application/service/agent.service';
import { SkillService } from '../modules/agent/application/service/skill.service';
import { GetRunViewQuery } from '../modules/agent/application/query/run.queries';

@controller('/api/agent')
export default class AgentController {
  constructor(
    @inject(AgentService) private readonly agentService: AgentService,
    @inject(SkillService) private readonly skillService: SkillService,
    @inject(QueryBus) private readonly queryBus: QueryBus,
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

  /** 取任意 run（含子 agent run）的投影视图：live 优先、repo 回落，不存在 404。 */
  @api('/runs/:runId', { method: 'get' })
  async getRunView(@param('runId') runId: string, @response() res: Response) {
    const result = await this.queryBus.execute(new GetRunViewQuery(runId));
    if (!result) return res.status(404).json({ error: 'Run not found' });
    return res.json(result);
  }
}
