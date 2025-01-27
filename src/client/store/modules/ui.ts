import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

export type UiState = {};

export class UiStore {
  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }
}
