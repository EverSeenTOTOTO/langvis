import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';

@store()
export class AgentStore {
  /** 收敛单一 agent 后返回单个全局配置对象（原 agents 列表的替代）。 */
  @api('/api/agent')
  getConfig(_params?: any, req?: ApiRequest) {
    return req!.send();
  }
}
