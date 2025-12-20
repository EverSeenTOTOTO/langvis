import { container } from 'tsyringe';
import type { Express } from 'express';
import bindApi from './api';
import { logger } from '../middleware/logger';

const metaDataKey = Symbol('controller');

export function controller(namespace = ''): ClassDecorator {
  return function controllerDecorator(target: any) {
    Reflect.defineMetadata(metaDataKey, { namespace }, target);
  };
}

export default <C extends Record<string, any>>(
  Clz: new (...params: any[]) => C,
  app: Express,
) => {
  const instance = container.resolve(Clz);
  const { namespace } = Reflect.getMetadata(metaDataKey, Clz);

  logger.info(`Binding controller: ${namespace}`);
  bindApi(instance, namespace, app);

  return instance;
};
