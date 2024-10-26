import { catchGuard } from '@/client/decorator/catchGuard';
import { hydrate } from '@/client/decorator/hydrate';
import { promisify } from '@/client/decorator/promisify';
import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

export class HomeStore {
  root: AppStore;

  @hydrate()
  countries: { id: string; name: string }[] = [];

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  @promisify()
  @catchGuard()
  async test() {
    const res = await this.root.supabase.client.from('countries').select();

    if (res.data) {
      this.countries = res.data;
    } else {
      throw res.error;
    }
  }
}
