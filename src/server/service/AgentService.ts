import { container, singleton } from 'tsyringe';
import { Agent } from '../core/agent';
import { logger } from '../middleware/logger';

@singleton()
export class AgentService {
  private initPromise: Promise<void> | null = null;
  private agentIds: symbol[] = [];

  constructor() {
    this.initPromise = this.initAgents();
  }

  private async initAgents() {
    const agentModules = import.meta.glob('../core/agent/*/index.ts', {
      eager: true,
    });

    for (const modulePath of Object.keys(agentModules)) {
      try {
        const match = modulePath.match(/\/([^/]+)\/index\.ts$/);

        if (match) {
          const agentId = Symbol.for(match[1]);
          const agentModule = await import(modulePath);

          logger.info(`Registering agent: ${match[1]}`);

          this.agentIds.push(agentId);
          container.register(agentId, agentModule.default);
        }
      } catch (error) {
        logger.error(`Failed to load agent from ${modulePath}:`, error);
      }
    }
  }

  async getAllAgents(): Promise<Agent[]> {
    await this.initPromise;

    return this.agentIds.map(id => container.resolve<Agent>(id));
  }

  async getAgent(name: string): Promise<Agent | undefined> {
    await this.initPromise;

    return container.resolve<Agent>(Symbol.for(name));
  }
}
