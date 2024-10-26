import 'reflect-metadata';
import { getOwnPropertyNames } from '../constants';

const metaDataKey = Symbol('hydrate');

export type HydrateConfig = {
  // 目标属性水化时如何从预取数据中获取
  onHydrate?(state: any): any;
  // 目标属性脱水时如何从服务端状态实例中获取
  onDehydra?(): any;
};

export function hydrate(config?: HydrateConfig) {
  return function hydrateDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(metaDataKey, config || true, target, propertyKey);
  };
}

export function wrapHydrate(
  instance: Record<string, any>,
  prop: string,
  config?: HydrateConfig,
) {
  return {
    onHydrate(state: Record<string, any>) {
      return config?.onHydrate
        ? config.onHydrate(state)
        : state?.[prop] || instance[prop];
    },
    onDehydra() {
      return config?.onDehydra ? config.onDehydra() : instance[prop];
    },
  };
}

export default function <T extends Record<string, any>>(instance: T) {
  getOwnPropertyNames(instance).forEach(prop => {
    const config = Reflect.getMetadata(metaDataKey, instance, prop);

    if (!config) return;

    const { onHydrate, onDehydra } = wrapHydrate(instance, prop, config);

    const oldHydrate = instance.hydrate
      ? instance.hydrate.bind(instance)
      : () => {};
    const oldDehydra = instance.dehydra
      ? instance.dehydra.bind(instance)
      : () => ({});

    Reflect.set(instance, 'hydrate', (state: Record<string, any>) => {
      oldHydrate?.(state);
      Reflect.set(instance, prop, onHydrate(state));
    });

    Reflect.set(instance, 'dehydra', () => {
      return {
        ...oldDehydra?.(),
        [prop]: onDehydra(),
      };
    });
  });

  return instance;
}
