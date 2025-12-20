import { singleton, container, Lifecycle, inject } from 'tsyringe';
import { globby } from 'globby';
import { __dirname } from '@/server/utils';
import { AgentConstructor } from '../core/agent';
import { logger } from '../middleware/logger';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { ToolService } from './ToolService';

export interface AgentMeta {
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

  constructor(
    @inject(ToolService)
    private toolService: ToolService,
  ) {
    this.initialize().catch(error => {
      this.isInitialized = false;
      logger.error('❌ Failed to initialize AgentService:', error);
    });
  }

  async getAllAgentInfo(): Promise<AgentInfo[]> {
    await this.initialize();
    return [...this.agents.values()];
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize tools first
    await this.toolService.getAllToolInfo();

    const agents = await this.discoverAgents();

    logger.info(
      `🤖 Discovered ${agents.length} agents:`,
      agents.map(a => a.class.name),
    );

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
        async (_token, instance: object) => {
          // Inject name and description
          if (instance && 'name' in instance && 'description' in instance) {
            Reflect.set(instance, 'name', agent.meta.name.en);
            Reflect.set(instance, 'description', agent.meta.description.en);
          }

          // Inject tools
          if (instance && 'tools' in instance) {
            const toolNames = agent.meta.tools || [];

            const tools = await this.toolService.getToolsByNames(toolNames);

            Reflect.set(instance, 'tools', tools);
            logger.info(
              `✅ Injected ${toolNames.length} tools into agent: ${agentName}`,
            );
          }
        },
        { frequency: 'Once' },
      );

      logger.info(`✅ Agent registered successfully: ${agentName}`);
    });

    this.isInitialized = true;
  }

  private async discoverAgents() {
    const pattern = '../core/agent/*/index.ts';
    const cwd = __dirname();

    const agentPaths = await globby(pattern, {
      cwd,
      absolute: true,
    });

    const agents: {
      class: AgentConstructor;
      meta: AgentMeta;
    }[] = [];

    for (const absolutePath of agentPaths) {
      try {
        const agent = await this.loadAgent(absolutePath);
        if (agent) {
          agents.push(agent);
        }
      } catch (error) {
        logger.error(
          `❌ Failed to process agent module ${absolutePath}:`,
          error,
        );
      }
    }

    return agents;
  }

  private async loadAgent(absolutePath: string) {
    const module = await import(absolutePath);
    const agentClass = module.default;

    if (!agentClass) {
      logger.warn(`⚠️ No default export found in: ${absolutePath}`);
      return null;
    }

    // Read config.json from the same directory
    const configPath = resolve(dirname(absolutePath), 'config.json');
    let metaData: AgentMeta;

    try {
      const configContent = await readFile(configPath, 'utf-8');
      metaData = JSON.parse(configContent);
    } catch (error) {
      logger.warn(
        `❌ No config.json found for agent at ${absolutePath}:`,
        error,
      );
      return null;
    }

    return { class: agentClass, meta: metaData };
  }
}
