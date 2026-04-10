import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';

@store()
export class ModelStore {
  @api('/api/models')
  getModels(_params?: { type?: string }, req?: ApiRequest) {
    return req!.send();
  }
}
