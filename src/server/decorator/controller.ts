import { container, singleton } from 'tsyringe';
import type { Express } from 'express';
import bindApi from './api';
import logger from '../utils/logger';
import chalk from 'chalk';

const metaDataKey = Symbol('controller');

export function controller(namespace = ''): ClassDecorator {
  return function controllerDecorator(target: any) {
    singleton()(target);
    Reflect.defineMetadata(metaDataKey, { namespace }, target);
  };
}

export default <C extends Record<string, any>>(
  Clz: new (...params: any[]) => C,
  app: Express,
) => {
  const instance = container.resolve(Clz);
  const { namespace } = Reflect.getMetadata(metaDataKey, Clz);

  bindApi(instance, namespace, app);

  logger.info(`Binded with namespace: ${chalk.yellow(namespace)}`);

  return instance;
};
