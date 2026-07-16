import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import chalk from 'chalk';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Tool } from '../modules/agent/domain/model/tool.base';
import logger from '../utils/logger';

const metaDataKey = Symbol.for('config');

export const tool = (token?: ToolIds) =>
  function configDecorator(target: any) {
    injectable()(target);
    Reflect.defineMetadata(metaDataKey, { type: 'tool', token }, target);
  };

export const registerTool = async <I, O>(
  Clz: new (...params: any[]) => Tool,
  config: ToolConfig<I, O>,
) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Tool>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register tool ${chalk.cyan(config.name)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    (_token, instance: any) => {
      Reflect.set(instance, 'config', config);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'logger', logger.child({ source: token }));
    },
    { frequency: 'Once' },
  );

  return token;
};
