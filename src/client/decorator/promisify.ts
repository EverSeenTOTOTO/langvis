import 'reflect-metadata';
import { getOwnPropertyNames, isAsyncFunction } from '../constants';

const metaDataKey = Symbol('promisify');

export function promisify(): PropertyDecorator {
  return function promisifyDecorator(
    target: any,
    propertyKey: string | symbol,
  ) {
    Reflect.defineMetadata(metaDataKey, true, target, propertyKey);
  };
}

// 对 fn 进行包装
export function wrapPromisify<T, R>(fn: (...args: T[]) => R) {
  return isAsyncFunction(fn)
    ? fn
    : async function promisify(...args: T[]) {
        return fn(...args);
      };
}

export default function <T extends Record<string, any>>(instance: T) {
  getOwnPropertyNames(instance).forEach(prop => {
    const action = Reflect.getMetadata(metaDataKey, instance, prop);

    if (action) {
      Reflect.set(instance, prop, wrapPromisify(instance[prop].bind(instance)));
    }
  });

  return instance;
}
