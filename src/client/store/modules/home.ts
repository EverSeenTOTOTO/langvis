import { api, type ApiResponse } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { autorun, makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  @hydrate()
  availableGraphs: {
    id: string;
    name: string;
  }[] = [];

  @hydrate()
  currentGraphId?: string;

  loading?: boolean;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;

    autorun(() => {
      if (this.currentGraphId) {
        this.root.graph.fetchGraphNodes({ graphId: this.currentGraphId });
      }
    });
  }

  toggleGraph(id: string) {
    this.currentGraphId = id;
  }

  @api('/api/graph/all')
  async fetchAvailableGraphs(_req: void, res?: ApiResponse) {
    this.availableGraphs = res!.data;
    this.currentGraphId = res!.data?.[0]?.id;
  }
}
