import { AgentIds, MemoryIds, ToolIds } from '@/shared/constants';
import { AgentConfig, ToolConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import chalk from 'chalk';
import { isArray, mergeWith } from 'lodash-es';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Agent } from '../core/agent';
import { Memory } from '../core/memory';
import { Tool } from '../core/tool';
import logger from '../utils/logger';
import { parse } from '../utils/schemaValidator';
import { PARAM_METADATA_KEY, ParamMetadata, ParamType } from './param';

const metaDataKey = Symbol('config');

function createConfigDecorator(type: 'agent' | 'tool' | 'memory') {
  return (token?: ToolIds | AgentIds | MemoryIds) =>
    function configDecorator(target: any) {
      injectable()(target);
      Reflect.defineMetadata(metaDataKey, { type, token }, target);
    };
}

export const agent = createConfigDecorator('agent');
export const tool = createConfigDecorator('tool');
export const memory = createConfigDecorator('memory');

const resolveConfig = (config: AgentConfig | ToolConfig) => {
  if (!config.extends) return config;

  const target = container.resolve<Agent | Tool>(config.extends);

  return mergeWith({}, target.config, config, (objValue, srcValue) => {
    if (isArray(objValue)) {
      return objValue.concat(srcValue);
    }
    return;
  });
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
    instance[method] = async function* (...args: any[]) {
      for (const meta of validationMeta) {
        if (meta.type === validationType) {
          try {
            const arg = args[meta.index];
            const validated = parse(schema, arg ?? {});
            args[meta.index] = validated;
          } catch (error) {
            logger.error(
              `Validation failed for ${token} method ${method}: ${(error as Error).message}`,
            );
            throw error;
          }
        }
      }
      yield* originalMethod(...args);
    };
  }
};

export const registerAgent = async <T>(
  Clz: new (...params: any[]) => Agent,
  config: AgentConfig<T>,
) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Agent>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register agent ${chalk.cyan(config.name)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    async (_token, instance: any) => {
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'logger', logger.child({ source: token }));

      // Inject tools
      if (instance && 'tools' in instance) {
        const toolTokens = config.tools || [];

        const tools = toolTokens.map(t => container.resolve<Tool>(t));

        Reflect.set(instance, 'tools', tools);

        logger.info(
          `Injected ${tools.length} tools into agent: ${chalk.cyan(config.name)}`,
        );
      }

      proxyValidation(
        instance,
        'call',
        ParamType.CONFIG,
        (merged as AgentConfig<T>).configSchema,
        token,
      );
    },
    { frequency: 'Once' },
  );

  return token;
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
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'logger', logger.child({ source: token }));

      proxyValidation(
        instance,
        'call',
        ParamType.INPUT,
        (merged as ToolConfig<I, O>).inputSchema,
        token,
      );
    },
    { frequency: 'Once' },
  );

  return token;
};

export const registerMemory = async (Clz: new (...params: any[]) => Memory) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  logger.info(
    `Register memory module ${chalk.cyan(Clz.name)} with token ${chalk.yellow(token)}`,
  );

  container.register<Memory>(token, Clz, {
    lifecycle: Lifecycle.Transient,
  });

  container.afterResolution(
    token,
    async (_token, instance: any) => {
      Reflect.set(instance, 'logger', logger.child({ source: token }));
    },
    { frequency: 'Always' },
  );

  return token;
};
