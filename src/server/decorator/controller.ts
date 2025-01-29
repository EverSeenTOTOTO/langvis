import { getOwnPropertyNames } from '@/shared/constants';
import type { Express } from 'express';
import bindApi from './api';
import { injectKey } from './inject';

const metaDataKey = Symbol('controller');

export function controller(namespace = ''): ClassDecorator {
  return function controllerDecorator(target: any) {
    Reflect.defineMetadata(metaDataKey, { namespace }, target);
  };
}

export default <T, C extends Record<string, any>>(
  Clz: new (...params: T[]) => C,
  app: Express,
  pool: Record<string, any>,
) => {
  const instance = new Clz();
  const { namespace } = Reflect.getMetadata(metaDataKey, Clz);

  getOwnPropertyNames(instance).forEach(prop => {
    const injectPropName = Reflect.getMetadata(injectKey, instance, prop);

    if (injectPropName) {
      Reflect.set(instance, prop, pool[injectPropName]);
    }
  });

  bindApi(instance, namespace, app);

  return instance;
};
