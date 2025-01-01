import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

import { createClient } from '@supabase/supabase-js';

const client = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export class SupabaseStore {
  root: AppStore;

  client = client;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }
}
