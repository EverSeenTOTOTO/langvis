import { autorun, makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  currentGraphId?: string;

  availableGraphs: {
    id: string;
    name: string;
  }[] = [];

  loading?: boolean;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;

    autorun(() => {
      if (this.currentGraphId) {
        this.fetchGraphNodes(this.currentGraphId);
      }
    });
  }

  toggleGraph(id: string) {
    this.currentGraphId = id;
  }

  async fetchAvailableGraphs() {
    this.loading = true;

    const res = await fetch('/api/graph')
      .then(res => res.json())
      .finally(() => {
        this.loading = false;
      });

    if (res.data) {
      this.availableGraphs = res.data;
      this.currentGraphId = res.data[0]?.id;
    }
  }

  async fetchGraphNodes(graphId: string) {
    this.loading = true;

    const res = await fetch(`/api/nodes?graphId=${graphId}`)
      .then(res => res.json())
      .finally(() => {
        this.loading = false;
      });

    if (res.data) {
      this.root.graph.nodes = res.data;
    }
  }
}
