import { autorun, makeAutoObservable } from 'mobx';
import { type AppStore } from '..';
import { api, type ApiRequest, type ApiResponse } from '@/client/decorator/api';

export class HomeStore {
  root: AppStore;

  availableGraphs: {
    id: string;
    name: string;
  }[] = [];

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

  @api({ path: '/api/graph/all' })
  async fetchAvailableGraphs(_req: ApiRequest, res?: ApiResponse) {
    this.availableGraphs = res!.data;
    this.currentGraphId = res!.data[0]?.id;
  }
}
