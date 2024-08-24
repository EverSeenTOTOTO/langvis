import { makeAutoObservable } from 'mobx';
import type { AppStore, PrefetchStore } from '..';

type ThemeMode = 'light' | 'dark';

export type ThemeState = {
  mode: ThemeMode;
};

export class ThemeStore implements PrefetchStore<ThemeState> {
  mode: ThemeMode = 'light';

  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  toggleMode() {
    this.mode = this.mode === 'light' ? 'dark' : 'light';
  }

  hydrate(state: ThemeState): void {
    this.mode = state.mode;
  }

  dehydra(): ThemeState {
    return {
      mode: this.mode,
    };
  }
}
