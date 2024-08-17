import { Context } from '@/share/node';
import { action, computed, makeObservable, observable } from 'mobx';
import type { AppStore } from '..';

export class AboutStore extends Context {
  root: AppStore;

  constructor(root: AppStore) {
    super();
    this.root = root;
    this.nodes = observable.map(this.nodes, { deep: false });
    this.edges = observable.map(this.edges, { deep: false });

    makeObservable(this, {
      nodeCount: computed,
      edgeCount: computed,
      addNode: action,
      connect: action,
      deleteNode: action,
      deleteEdge: action,
    });
  }
}
