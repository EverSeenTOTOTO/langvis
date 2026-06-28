import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';

@store()
export class AgentStore {
  /** 返回聚合后的对话配置 schema（各域 ConfigFragment 平铺，供配置弹窗渲染）。 */
  @api('/api/agent')
  getConfig(_params?: any, req?: ApiRequest) {
    return req!.send();
  }
}
