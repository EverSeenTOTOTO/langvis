import { api, ApiRequest } from '@/client/decorator/api';
import { singleton } from 'tsyringe';

@singleton()
export class AgentStore {
  @api('/api/agent')
  getAllAgent(_params?: any, req?: ApiRequest) {
    return req!.send();
  }
}
