import { api, ApiRequest } from '@/client/decorator/api';
import { makeAutoObservable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { SSEStore } from './sse';

@singleton()
export class ExecuteStore {
  graphState?: 'BUILD' | 'VIEW' | 'RUNNING' = 'BUILD';

  constructor(@inject(SSEStore) private sse?: SSEStore) {
    makeAutoObservable(this, {});
  }

  @api('/api/execute/graph/:graphId')
  async runCurrentGraph(params: { graphId: string }, req?: ApiRequest) {
    await this.sse!.connect();
    this.sse!.register(`graph:${params.graphId}`, e => {
      const data = JSON.parse(e.data);
      console.log(data);
    });

    await req!.send();
  }
}
