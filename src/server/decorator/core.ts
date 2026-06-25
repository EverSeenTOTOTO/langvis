import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import chalk from 'chalk';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Tool } from '../modules/agent/domain/model/tool.base';
import logger from '../utils/logger';
import { parse } from '../utils/schemaValidator';
import { registerDisposableToken } from './disposal';
import { PARAM_METADATA_KEY, ParamMetadata, ParamType } from './param';

const metaDataKey = Symbol.for('config');

export const tool = (token?: ToolIds) =>
  function configDecorator(target: any) {
    injectable()(target);
    Reflect.defineMetadata(metaDataKey, { type: 'tool', token }, target);
    registerDisposableToken(target);
  };

const proxyValidation = <T>(
  instance: any,
  method: string,
  validationType: ParamType,
  schema: JSONSchemaType<T> | undefined,
  token: string,
) => {
  if (!schema) return;

  const prototype = Object.getPrototypeOf(instance);
  const validationMeta: ParamMetadata[] = Reflect.getMetadata(
    PARAM_METADATA_KEY,
    prototype,
    method,
  );

  if (validationMeta && validationMeta.length > 0) {
    const originalMethod = instance[method].bind(instance);
    instance[method] = async function* (
      ...args: any[]
    ): AsyncGenerator<any, any, void> {
      for (const meta of validationMeta) {
        if (meta.type === validationType) {
          try {
            const arg = args[meta.index];
            const validated = parse(schema, arg ?? {});
            args[meta.index] = validated;
          } catch (error) {
            logger.error(
              `Validation failed for ${token} method ${method}: ${(error as Error)?.message ?? String(error)}`,
            );
            throw error;
          }
        }
      }
      return yield* originalMethod(...args);
    };
  }
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
    async (_token, instance: any) => {
      Reflect.set(instance, 'config', config);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'logger', logger.child({ source: token }));

      proxyValidation(
        instance,
        'call',
        ParamType.INPUT,
        config.inputSchema,
        token,
      );
    },
    { frequency: 'Once' },
  );

  return token;
};
