import { hydrate } from '@/client/decorator/hydrate';
import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

type ThemeMode = 'light' | 'dark';

export class ThemeStore {
  @hydrate()
  mode: ThemeMode = 'dark';

  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  toggleMode() {
    this.mode = this.mode === 'light' ? 'dark' : 'light';
  }
}
