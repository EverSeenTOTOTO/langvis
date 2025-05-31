import { configure } from 'mobx';
import 'reflect-metadata';
import { container } from 'tsyringe';
import composeApi from '../decorator/api';
import composeHydrate from '../decorator/hydrate';
import { AuthStore } from './modules/auth';
import { GraphStore } from './modules/graph';
import { HomeStore } from './modules/home';
import { SettingStore } from './modules/setting';
import { SSEStore } from './modules/sse';
import { ExecuteStore } from './modules/execute';

configure({ enforceActions: 'never' });

const bindStore = <C extends Record<string, any>>(
  Clz: new (...params: any[]) => C,
) => {
  return [composeApi, composeHydrate].reduce(
    (instance, compose) => compose(instance),
    container.resolve(Clz),
  );
};

export class AppStore {
  home = bindStore(HomeStore);

  graph = bindStore(GraphStore);

  execute = bindStore(ExecuteStore);

  setting = bindStore(SettingStore);

  sse = bindStore(SSEStore);

  auth = bindStore(AuthStore);

  hydrate(data: Record<string, any>) {
    Object.keys(data).forEach(key => {
      const store = this[key as keyof AppStore] as {
        hydrate?: (data: any) => void;
      };

      store?.hydrate?.(data[key]);
    });
  }

  dehydra() {
    const data: Record<string, any> = {};

    Object.keys(this).forEach(key => {
      const store = this[key as keyof AppStore] as {
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
