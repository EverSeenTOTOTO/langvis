import { Controller, Get, HttpException, Inject, Param } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { configSchema } from '@/server/modules/conversation/domain/config';
import { SkillService } from './application/service/skill.service';
import { GetRunViewQuery } from '@/server/modules/conversation/contracts';

@Controller('agent')
export class AgentController {
  constructor(
    @Inject(SkillService) private readonly skillService: SkillService,
    @Inject(QueryBus) private readonly queryBus: QueryBus,
  ) {}

  // 收敛单一 agent 后返回聚合后的对话配置 schema（各域 ConfigFragment 平铺）。
  @Get()
  getConfig() {
    return configSchema;
  }

  @Get('skills')
  async listSkills() {
    return this.skillService.getAllSkillInfo();
  }

  /** 取任意 run（含子 agent run）的投影视图：live 优先、repo 回落，不存在 404。 */
  @Get('runs/:runId')
  async getRunView(@Param('runId') runId: string) {
    const result = await this.queryBus.execute(new GetRunViewQuery(runId));
    if (!result) {
      throw new HttpException({ error: 'Run not found' }, 404);
    }
    return result;
  }
}
