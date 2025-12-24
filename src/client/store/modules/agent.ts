import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';

@store()
export class AgentStore {
  @api('/api/agent')
  getAllAgent(_params?: any, req?: ApiRequest) {
    return req!.send();
  }
}
