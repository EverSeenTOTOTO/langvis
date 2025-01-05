import { makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  async test() {
    const res = await fetch('/api/node').then(res => res.json());

    if (res.data) {
      this.root.graph.nodes = res.data.map(node => ({
        ...node,
        data: {
          ...node.data,
          text: node.name,
        },
        position: { x: node.x || 0, y: node.y || 0 },
      }));
    }
  }
}
