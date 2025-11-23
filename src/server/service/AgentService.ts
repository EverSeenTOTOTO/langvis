import { singleton, container, Lifecycle } from 'tsyringe';
import { globby } from 'globby';
import { AgentMetas, AgentToolMeta, ToolMetas } from '@/shared/constants';
import { __dirname } from '@/server/utils';
import { Tool, ToolConstructor } from '../core/tool';
import { AgentConstructor } from '../core/agent';
import { logger } from '../middleware/logger';

const fullMeta = {
  ...AgentMetas,
  ...ToolMetas,
};

export type AgentInfo = {
  name: string;
  description: string;
};

@singleton()
export class AgentService {
  private readonly agents = new Map<string, AgentInfo>();
  private isInitialized = false;

  async getAllAgentInfo(): Promise<AgentInfo[]> {
    await this.initialize();
    return [...this.agents.values()];
  }

  async getAgentInfoByName(name: string): Promise<AgentInfo | undefined> {
    await this.initialize();
    return this.agents.get(name);
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
      tools.map(t => t.class.Name),
    );
    logger.info(
      `🤖 Discovered ${agents.length} agents:`,
      agents.map(a => a.class.Name),
    );

    // Register tools
    tools.map(tool => {
      container.register(tool.class.Name, tool.class, {
        lifecycle: Lifecycle.Singleton,
      });
      logger.info(`✅ Tool registered successfully: ${tool.class.Name}`);
    });

    // Register agents
    agents.map(agent => {
      container.register(agent.class.Name, agent.class, {
        lifecycle: Lifecycle.Singleton,
      });

      const agentInfo = {
        name: agent.meta.Name.en,
        description: agent.meta.Description.en,
      };
      this.agents.set(agent.class.Name, agentInfo);

      // Setup dependency injection for agent tools
      container.afterResolution(
        agent.class.Name,
        (_token, instance: object) => {
          if (instance && 'tools' in instance) {
            const dependencies = agent.meta.Dependencies || [];

            const tools = dependencies.map(name =>
              container.resolve<Tool>(name),
            );

            Reflect.set(instance, 'tools', tools);
            logger.info(
              `✅ Injected ${tools.length} tools into agent: ${agent.class.Name}`,
            );
          }
        },
        { frequency: 'Always' },
      );

      logger.info(`✅ Agent registered successfully: ${agent.class.Name}`);
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

    const metaData = Object.keys(fullMeta).find(key => {
      const metaName = fullMeta[key].Name.en;
      return metaName === entityClass.Name;
    });

    if (!metaData) {
      logger.warn(`❌ No metadata found for entity ${entityClass.Name}`);
      return null;
    }

    return { class: entityClass, meta: fullMeta[metaData] };
  }
}
