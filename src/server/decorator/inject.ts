import 'reflect-metadata';

export const injectKey = Symbol('inject');

export function inject(propName?: string | symbol): PropertyDecorator {
  return function injectDecorator(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata(
      injectKey,
      propName ?? propertyKey,
      target,
      propertyKey,
    );
  };
}
