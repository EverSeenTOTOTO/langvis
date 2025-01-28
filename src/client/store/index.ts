import { HomeStore } from './modules/home';
import { GraphStore } from './modules/graph';
import { ThemeStore } from './modules/theme';
import composeCatchGuard from '../decorator/catchGuard';
import composePromisify from '../decorator/promisify';
import composeApi from '../decorator/api';
import composeHydrate from '../decorator/hydrate';
import { configure } from 'mobx';

configure({ enforceActions: 'never' });

const newStore = <T, C extends Record<string, any>>(
  Clz: new (...params: T[]) => C,
  ...params: T[]
) => {
  // mobx 的Proxy wrap 会错误将异步函数包装成同步，所以需要先 promisify，不然 catchGuard 会失效
  return [
    composeApi,
    composePromisify,
    composeCatchGuard,
    composeHydrate,
  ].reduce((instance, compose) => compose(instance), new Clz(...params));
};

export class AppStore {
  home: HomeStore;

  graph: GraphStore;

  theme: ThemeStore;

  constructor() {
    this.home = newStore(HomeStore, this);
    this.graph = newStore(GraphStore, this);
    this.theme = newStore(ThemeStore, this);
  }

  hydrate(data: Record<string, any>) {
    Object.keys(data).forEach(key => {
      const store = this[key as keyof AppStore] as unknown as {
        hydrate?: (data: any) => void;
      };

      store?.hydrate?.(data[key]); // 参数类型是逆变的
    });
  }

  dehydra() {
    const data: Record<string, any> = {};

    Object.keys(this).forEach(key => {
      const store = this[key as keyof AppStore] as unknown as {
        dehydra?: () => unknown;
      };

      data[key] = store?.dehydra?.() as any;
    });

    return data;
  }
}

const appStore = new AppStore();

export const createStore = () => appStore;
export const useStore = <T extends keyof AppStore>(key: T): AppStore[T] =>
  appStore[key];
export const getStore = useStore;
