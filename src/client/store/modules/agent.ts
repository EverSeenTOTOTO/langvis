import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type { SkillInfo } from '@/shared/types';

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
}
