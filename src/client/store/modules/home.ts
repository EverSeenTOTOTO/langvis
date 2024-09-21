import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

export type HomeState = {
  name: string;
};

export class HomeStore {
  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }
}
