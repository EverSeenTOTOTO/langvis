import { getOwnPropertyNames } from '@/shared/constants';
import { action } from 'mobx';

const metaDataKey = Symbol('hydrate');

// 目标属性水化时如何从预取数据state中提取并还原到客户端实例
export type HydrateMethod = string | ((state: any) => any);

export function hydrate(config?: HydrateMethod) {
  return function hydrateDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(
      metaDataKey,
      config || propertyKey,
      target,
      propertyKey,
    );
  };
}

export function wrapHydrate(
  instance: Record<string, any>,
  prop: string,
  config?: HydrateMethod,
) {
  return (state: Record<string, any>) => {
    if (typeof config === 'function') {
      return config(state);
    }

    if (config && config in state) {
      return state[config];
    }

    return prop in state
      ? state[prop]
      : /* 提取失败回退前端默认值 */ instance[prop];
  };
}

export default function <T extends Record<string, any>>(instance: T) {
  const hydrateFns: ((state: any) => any)[] = [];
  const dehydraProps: (string | symbol)[] = [];

  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (!config) return;

    const onHydrate = wrapHydrate(instance, prop, config);

    hydrateFns.push(state => Reflect.set(instance, prop, onHydrate?.(state)));
    dehydraProps.push(prop);
  });

  Reflect.set(
    instance,
    'hydrate',
    action((state: Record<string, any>) => {
      // 逐个属性水化
      hydrateFns.forEach(fn => fn(state));
    }),
  );
  Reflect.set(instance, 'dehydra', () => {
    // 逐个属性脱水
    return dehydraProps.reduce(
      (data, prop) => {
        return {
          ...data,
          [prop]: Reflect.get(instance, prop),
        };
      },
      {} as Record<string, any>,
    );
  });

  return instance as T & {
    hydrate(state: Record<string, any>): void;
    dehydra(): Record<string, any>;
  };
}
