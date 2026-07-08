import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type { SkillInfo } from '@/shared/types';
import type { RunViewResult } from '@/server/modules/conversation/application/service/run-projection';

@store()
export class AgentStore {
  /** 返回聚合后的对话配置 schema（各域 ConfigFragment 平铺，供配置弹窗渲染）。 */
  @api('/api/agent')
  getConfig(_params?: any, req?: ApiRequest) {
    return req!.send();
  }

  /** 可用技能列表，供 `/` 触发的技能选择器消费。 */
  @api('/api/agent/skills')
  async listSkills(_params?: void, req?: ApiRequest): Promise<SkillInfo[]> {
    return (await req!.send()) as SkillInfo[];
  }

  /** 取任意 run（含子 agent run）的投影视图：live 优先、repo 回落。 */
  @api('/api/agent/runs/:runId')
  async getRunViewById(
    _params: { runId: string },
    req?: ApiRequest<{ runId: string }>,
  ): Promise<RunViewResult | undefined> {
    return (await req!.send()) as RunViewResult | undefined;
  }
}
