import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, ToolConfig } from '@/shared/types';
import { isArray, mergeWith } from 'lodash-es';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Agent } from '../core/agent';
import { Tool } from '../core/tool';
import logger from '../utils/logger';
import chalk from 'chalk';
import { PARAM_METADATA_KEY, ParamMetadata, ParamType } from './param';
import { validateConfig } from '../utils/configValidation';

const metaDataKey = Symbol('config');

function createConfigDecorator(type: 'agent' | 'tool') {
  return (token: ToolIds | AgentIds) =>
    function configDecorator(target: any) {
      injectable()(target);
      Reflect.defineMetadata(metaDataKey, { type, token }, target);
    };
}

export const agent = createConfigDecorator('agent');
export const tool = createConfigDecorator('tool');

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

const proxyValidation = (
  instance: any,
  method: string,
  validationType: ParamType,
  schema: any,
  token: string,
) => {
  const prototype = Object.getPrototypeOf(instance);
  const validationMeta: ParamMetadata[] = Reflect.getMetadata(
    PARAM_METADATA_KEY,
    prototype,
    method,
  );

  if (validationMeta && validationMeta.length > 0) {
    const originalMethod = instance[method].bind(instance);
    instance[method] = async function (...args: any[]) {
      for (const meta of validationMeta) {
        if (meta.type === validationType) {
          try {
            const arg = args[meta.index];
            const validated = validateConfig(schema, arg);
            args[meta.index] = validated;
          } catch (error) {
            logger.error(
              `Validation failed for ${token} method ${method}: ${(error as Error).message}`,
            );
            throw error;
          }
        }
      }
      return originalMethod(...args);
    };
  }
};

export const registerAgent = async (
  Clz: new (...params: any[]) => Agent,
  config: AgentConfig,
) => {
  const { token, type } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Agent>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register agent ${chalk.cyan(config.name.en)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    async (_token, instance: any) => {
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'type', type);
      Reflect.set(instance, 'logger', logger.child({ source: token }));

      // Inject tools
      if (instance && 'tools' in instance) {
        const toolTokens = config.tools || [];

        const tools = toolTokens.map(token => container.resolve<Tool>(token));

        Reflect.set(instance, 'tools', tools);

        logger.info(
          `Injected ${tools.length} tools into agent: ${chalk.cyan(config.name.en)}`,
        );
      }

      // Proxy methods for validation
      proxyValidation(
        instance,
        'streamCall',
        ParamType.CONFIG,
        (merged as AgentConfig).config,
        token,
      );

      proxyValidation(
        instance,
        'call',
        ParamType.CONFIG,
        (merged as AgentConfig).config,
        token,
      );
    },
    { frequency: 'Once' },
  );

  return token;
};

export const registerTool = async (
  Clz: new (...params: any[]) => Tool,
  config: ToolConfig,
) => {
  const { token, type } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Tool>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register tool ${chalk.cyan(config.name.en)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    async (_token, instance: any) => {
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);
      Reflect.set(instance, 'type', type);
      Reflect.set(instance, 'logger', logger.child({ source: token }));

      // Proxy methods for validation
      proxyValidation(
        instance,
        'call',
        ParamType.INPUT,
        (merged as ToolConfig).input,
        token,
      );

      proxyValidation(
        instance,
        'streamCall',
        ParamType.INPUT,
        (merged as ToolConfig).input,
        token,
      );
    },
    { frequency: 'Once' },
  );

  return token;
};
