import { makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  test() {
    fetch('/api/test')
      .then(rsp => rsp.json())
      .then(graph => {
        console.log(graph);

        this.root.graph.nodes = graph;
      });
  }
}
