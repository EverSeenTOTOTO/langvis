import 'reflect-metadata';
import { getOwnPropertyNames, isAsyncFunction } from '../constants';

const metaDataKey = Symbol('catchGuard');

export function catchGuard(
  action?: (error: unknown) => void,
): PropertyDecorator {
  return function catchGuardDecorator(
    target: any,
    propertyKey: string | symbol,
  ) {
    Reflect.defineMetadata(metaDataKey, action, target, propertyKey);
  };
}

export function wrapCatchGuard<T, R>(
  fn: (...args: T[]) => R,
  dispatchError = (error: unknown): void => {
    throw error;
  },
) {
  return isAsyncFunction(fn)
    ? async function asyncGuardFn(...args: T[]) {
        try {
          return await fn(...args);
        } catch (e) {
          return dispatchError(e);
        }
      }
    : function syncGuardFn(...args: T[]) {
        try {
          return fn(...args);
        } catch (e) {
          return dispatchError(e);
        }
      };
}

export default function <T extends Record<string, any>>(instance: T) {
  getOwnPropertyNames(instance).forEach(prop => {
    const action = Reflect.getMetadata(metaDataKey, instance, prop);

    if (action) {
      Reflect.set(
        instance,
        prop,
        wrapCatchGuard(instance[prop].bind(instance), action),
      );
    }
  });

  return instance;
}
