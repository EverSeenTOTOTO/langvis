import { AgentConfig } from '@/shared/types';
import { globby } from 'globby';
import path from 'path';
import { container, inject } from 'tsyringe';
import { AgentConstructor } from '../core/agent';
import { registerAgent } from '../decorator/core';
import { service } from '../decorator/service';
import { ToolService } from './ToolService';
import { isProd } from '../utils';
import Logger from '../utils/logger';

@service()
export class AgentService {
  private agents: string[] = [];
  private isInitialized = false;

  private readonly logger = Logger.child({ source: 'AgentService' });

  constructor(
    @inject(ToolService)
    private toolService: ToolService,
  ) {
    this.initialize();
  }

  async getAllAgentInfo() {
    await this.initialize();
    return this.agents.map(agent => ({
      id: agent,
      ...container.resolve<any>(agent)?.config,
    }));
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

    try {
      // Initialize tools first
      await this.toolService.getAllToolInfo();

      const agents = await this.discoverAgents();

      this.logger.info(
        `Discovered ${agents.length} agents:`,
        agents.map(a => a.clazz.name),
      );

      // Register agents
      this.agents = await Promise.all(
        agents.map(agent => registerAgent(agent.clazz, agent.config)),
      );
    } catch (e) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize AgentService:', e);
    }
  }

  private async discoverAgents() {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/core/agent/*/index${suffix}`;

    const agentPaths = await globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    });

    const agents: {
      clazz: AgentConstructor;
      config: AgentConfig;
    }[] = [];

    for (const absolutePath of agentPaths) {
      try {
        const [{ default: clazz }, { config }] = await Promise.all([
          import(absolutePath),
          import(path.resolve(path.dirname(absolutePath), `config${suffix}`)),
        ]);

        if (clazz && config) {
          agents.push({
            clazz,
            config,
          });
        } else {
          this.logger.warn(
            `Incomplete agent module at ${path.basename(absolutePath, suffix)}`,
          );
        }
      } catch (error) {
        Logger.error(`Failed to process agent module ${absolutePath}:`, error);
      }
    }

    return agents;
  }
}
