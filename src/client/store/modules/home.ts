import { makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }
}
