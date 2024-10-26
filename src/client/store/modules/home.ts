import { makeAutoObservable } from 'mobx';
import type { AppStore, PrefetchStore } from '..';

export type HomeState = {
  countries: { id: string; name: string }[];
};

export class HomeStore implements PrefetchStore<HomeState> {
  root: AppStore;

  countries: { id: string; name: string }[] = [];

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  async test() {
    const { data } = await this.root.supabase.client.from('countries').select();

    this.countries = data;
  }

  hydrate(state: HomeState): void {
    this.countries = state.countries;
  }

  dehydra(): HomeState {
    return {
      countries: this.countries,
    };
  }
}
