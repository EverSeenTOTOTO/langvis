import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

import { SupabaseClient } from '@supabase/supabase-js';

export class SupabaseStore {
  root: AppStore;

  client?: SupabaseClient;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  setClient(client: SupabaseClient) {
    this.client = client;
  }
}
