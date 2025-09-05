import { configure } from 'mobx';
import 'reflect-metadata';
import { container } from 'tsyringe';
import composeApi from '../decorator/api';
import composeHydrate from '../decorator/hydrate';
import { AuthStore } from './modules/auth';
import { HomeStore } from './modules/home';
import { SettingStore } from './modules/setting';
import { UserStore } from './modules/user';

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

  setting = bindStore(SettingStore);

  auth = bindStore(AuthStore);

  user = bindStore(UserStore);

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
