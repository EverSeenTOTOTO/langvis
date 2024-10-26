import 'reflect-metadata';
import { getStore } from '../store';
import { getOwnPropertyNames, isAsyncFunction } from '../constants';

const metaDataKey = Symbol('catchGuard');

export type GuardAction = 'notify';

export function catchGuard(action: GuardAction = 'notify'): PropertyDecorator {
  return function catchGuardDecorator(
    target: any,
    propertyKey: string | symbol,
  ) {
    Reflect.defineMetadata(metaDataKey, action, target, propertyKey);
  };
}

// 对 fn 进行包装
export function wrapCatchGuard<T, R>(
  fn: (...args: T[]) => R,
  action: GuardAction,
) {
  const dispatchError = (e: unknown) => {
    const error = e as Error;

    switch (action) {
      case 'notify': {
        const ui = getStore('ui');

        ui.notify({
          type: 'error',
          message: error.message || 'Unknown error',
        });

        break;
      }
      default:
        throw e;
    }
  };

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
