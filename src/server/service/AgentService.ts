import { singleton, container, Lifecycle } from 'tsyringe';
import { globby } from 'globby';
import { __dirname } from '@/server/utils';
import { Tool, ToolConstructor } from '../core/tool';
import { AgentConstructor } from '../core/agent';
import { logger } from '../middleware/logger';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

export interface AgentToolMeta {
  name: {
    en: string;
    zh?: string;
    [key: string]: string | undefined;
  };
  description: {
    en: string;
    zh?: string;
    [key: string]: string | undefined;
  };
  tools?: string[];
  configItems?: any[];
}

export type AgentInfo = {
  name: string;
  description: string;
  configItems?: any[];
};

@singleton()
export class AgentService {
  private readonly agents = new Map<string, AgentInfo>();
  private isInitialized = false;

  async getAllAgentInfo(): Promise<AgentInfo[]> {
    await this.initialize();
    return [...this.agents.values()];
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const [tools, agents] = await Promise.all([
      this.discoverEntities('tool'),
      this.discoverEntities('agent'),
    ]);

    logger.info(
      `🔧 Discovered ${tools.length} tools:`,
      tools.map(t => t.class.name),
    );
    logger.info(
      `🤖 Discovered ${agents.length} agents:`,
      agents.map(a => a.class.name),
    );

    // Register tools
    tools.forEach(tool => {
      const toolName = tool.meta.name.en; // Use display name as token

      container.register(toolName, tool.class, {
        lifecycle: Lifecycle.Singleton,
      });

      // Inject metadata after resolution
      container.afterResolution(
        toolName,
        (_token, instance: object) => {
          if (instance && 'name' in instance && 'description' in instance) {
            Reflect.set(instance, 'name', tool.meta.name.en);
            Reflect.set(instance, 'description', tool.meta.description.en);
          }
        },
        { frequency: 'Once' },
      );

      logger.info(`✅ Tool registered successfully: ${toolName}`);
    });

    // Register agents
    agents.forEach(agent => {
      const agentName = agent.meta.name.en; // Use display name as token

      container.register(agentName, agent.class, {
        lifecycle: Lifecycle.Singleton,
      });

      const agentInfo = {
        name: agent.meta.name.en,
        description: agent.meta.description.en,
        configItems: agent.meta.configItems,
      };
      this.agents.set(agentName, agentInfo);

      // Setup dependency injection for agent metadata and tools
      container.afterResolution(
        agentName,
        (_token, instance: object) => {
          // Inject name and description
          if (instance && 'name' in instance && 'description' in instance) {
            Reflect.set(instance, 'name', agent.meta.name.en);
            Reflect.set(instance, 'description', agent.meta.description.en);
          }

          // Inject tools
          if (instance && 'tools' in instance) {
            const toolNames = agent.meta.tools || [];

            const tools = toolNames.map(name => container.resolve<Tool>(name));

            Reflect.set(instance, 'tools', tools);
            logger.info(
              `✅ Injected ${tools.length} tools into agent: ${agentName}`,
            );
          }
        },
        { frequency: 'Once' },
      );

      logger.info(`✅ Agent registered successfully: ${agentName}`);
    });

    this.isInitialized = true;
  }

  private async discoverEntities(type: 'agent' | 'tool') {
    const pattern = `../core/${type}/*/index.ts`;
    const cwd = __dirname();

    const agentPaths = await globby(pattern, {
      cwd,
      absolute: true,
    });

    const entities: {
      class: AgentConstructor | ToolConstructor;
      meta: AgentToolMeta;
    }[] = [];

    for (const absolutePath of agentPaths) {
      try {
        const entity = await this.loadEntity(absolutePath);
        if (entity) {
          entities.push(entity);
        }
      } catch (error) {
        logger.error(
          `❌ Failed to process ${type} module ${absolutePath}:`,
          error,
        );
      }
    }

    return entities;
  }

  private async loadEntity(absolutePath: string) {
    const module = await import(absolutePath);
    const entityClass = module.default;

    if (!entityClass) {
      logger.warn(`⚠️ No default export found in: ${absolutePath}`);
      return null;
    }

    // Read config.json from the same directory
    const configPath = resolve(dirname(absolutePath), 'config.json');
    let metaData: AgentToolMeta;

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      metaData = JSON.parse(configContent);
    } catch (error) {
      logger.warn(
        `❌ No config.json found for entity at ${absolutePath}:`,
        error,
      );
      return null;
    }

    return { class: entityClass, meta: metaData };
  }
}
