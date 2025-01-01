import 'reflect-metadata';
import { getOwnPropertyNames } from '../constants';

const metaDataKey = Symbol('hydrate');

// 目标属性水化时如何从预取数据state中提取并还原到客户端实例
export type HydrateMethod = (state: any) => any;

export function hydrate(config?: HydrateMethod) {
  return function hydrateDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, config || true, target, propertyKey);
  };
}

export function wrapHydrate(
  instance: Record<string, any>,
  prop: string,
  config?: HydrateMethod,
) {
  return (state: Record<string, any>) => {
    return typeof config === 'function'
      ? config(state)
      : prop in state
        ? state?.[prop]
        : /* 提取失败回退前端默认值 */ instance[prop];
  };
}

export default function <T extends Record<string, any>>(instance: T) {
  const hydrateFns: HydrateMethod[] = [];

  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (!config) return;

    const onHydrate = wrapHydrate(instance, prop, config);

    hydrateFns.push(state => Reflect.set(instance, prop, onHydrate?.(state)));

    Reflect.set(instance, 'hydrate', (state: Record<string, any>) => {
      hydrateFns.forEach(fn => fn(state));
    });
  });

  return instance as T & {
    hydrate(state: Record<string, any>): void;
  };
}
