import { HomeStore } from './modules/home';
import { GraphStore } from './modules/graph';
import { ThemeStore } from './modules/theme';
import { SupabaseStore } from './modules/supabase';

export type PrefetchStore<State> = {
  // merge ssr prefetched data
  hydrate(state: State): void;
  // provide ssr prefetched data
  dehydra(): State | undefined;
};

type GetStore<T> = {
  [K in keyof T]: T[K] extends PrefetchStore<infer S> ? S : never;
};

type GetKeys<T> = {
  [K in keyof T]: T[K] extends PrefetchStore<unknown> ? K : never;
}[keyof T];

export class AppStore {
  home: HomeStore;

  graph: GraphStore;

  theme: ThemeStore;

  supabase: SupabaseStore;

  constructor() {
    this.home = new HomeStore(this);
    this.graph = new GraphStore(this);
    this.theme = new ThemeStore(this);
    this.supabase = new SupabaseStore(this);
  }

  hydrate(data: GetStore<AppStore>) {
    Object.keys(data).forEach(key => {
      const k = key as GetKeys<AppStore>;

      this[k]?.hydrate?.(data[k] as any); // 参数类型是逆变的
    });
  }

  dehydra() {
    const data: Partial<GetStore<AppStore>> = {};

    Object.keys(this).forEach(key => {
      const k = key as GetKeys<AppStore>;

      data[k] = this[k]?.dehydra?.() as any;
    });

    return data;
  }
}

const appStore = new AppStore();

export const createStore = () => appStore;
export const useStore = <T extends keyof AppStore>(key: T): AppStore[T] =>
  appStore[key];
export const getStore = useStore;
