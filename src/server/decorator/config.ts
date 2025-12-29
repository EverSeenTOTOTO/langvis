import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, ToolConfig } from '@/shared/types';
import { isArray, mergeWith } from 'lodash-es';
import { container, injectable, Lifecycle } from 'tsyringe';
import { Agent } from '../core/agent';
import { Tool } from '../core/tool';
import logger from '../service/logger';
import chalk from 'chalk';

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

export const registerAgent = async (
  Clz: new (...params: any[]) => Agent,
  config: AgentConfig,
) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Agent>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register agent ${chalk.cyan(config.name.en)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    async (_token, instance: object) => {
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);

      // Inject tools
      if (instance && 'tools' in instance) {
        const toolTokens = config.tools || [];

        const tools = toolTokens.map(token => container.resolve<Tool>(token));

        Reflect.set(instance, 'tools', tools);

        logger.info(
          `Injected ${tools.length} tools into agent: ${chalk.cyan(config.name.en)}`,
        );
      }
    },
    { frequency: 'Once' },
  );

  return token;
};

export const registerTool = async (
  Clz: new (...params: any[]) => Tool,
  config: ToolConfig,
) => {
  const { token } = Reflect.getMetadata(metaDataKey, Clz);

  container.register<Tool>(token, Clz, {
    lifecycle: Lifecycle.Singleton,
  });

  logger.info(
    `Register tool ${chalk.cyan(config.name.en)} with token ${chalk.yellow(token)}`,
  );

  container.afterResolution(
    token,
    async (_token, instance: object) => {
      const merged = resolveConfig(config);

      Reflect.set(instance, 'config', merged);
      Reflect.set(instance, 'id', token);
    },
    { frequency: 'Once' },
  );

  return token;
};
