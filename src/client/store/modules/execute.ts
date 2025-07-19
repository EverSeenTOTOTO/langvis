import { api, ApiRequest } from '@/client/decorator/api';
import { makeAutoObservable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { SSEStore } from './sse';
import { GraphStore } from './graph';
import * as SSEvents from '@/shared/sse-events';

@singleton()
export class ExecuteStore {
  graphState?: 'BUILD' | 'VIEW' | 'RUNNING' = 'BUILD';

  constructor(
    @inject(SSEStore) private sse?: SSEStore,
    @inject(GraphStore) private graph?: GraphStore,
  ) {
    makeAutoObservable(this, {});
  }

  @api('/api/execute/graph/:graphId')
  async runCurrentGraph(params: { graphId: string }, req?: ApiRequest) {
    await this.sse!.connect();
    this.sse!.register(SSEvents.GraphRun(params.graphId), e => {
      const data = JSON.parse(e.data);
      console.log(data);
      this.graph!.setDisabled(true);
    });

    await req!.send();
  }
}
