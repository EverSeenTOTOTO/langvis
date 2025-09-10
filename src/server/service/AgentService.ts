import { singleton } from 'tsyringe';
import { globby } from 'globby';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AgentInfo = {
  name: string;
  description: string;
};

@singleton()
export class AgentService {
  private readonly agents: Map<string, AgentInfo> = new Map();
  private isInitialized = false;

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const agentPaths = await globby('../core/agent/*/index.ts', {
      cwd: __dirname,
      absolute: true,
    });

    for (const absolutePath of agentPaths) {
      try {
        const relativePath = path.relative(__dirname, absolutePath);

        const pathParts = relativePath.split(path.sep);
        const agentName = pathParts[pathParts.length - 2];

        // Skip non-agent directories
        if (agentName === 'agent') continue;

        const module = await import(absolutePath);
        const agentClass = module.default;

        if (!agentClass) {
          throw new Error(`No default export found in module ${relativePath}`);
        }
        if (!agentClass.Name) {
          throw new Error(
            `Agent class in ${relativePath} is missing static Name property`,
          );
        }
        if (!agentClass.Description) {
          throw new Error(
            `Agent class in ${relativePath} is missing static Description property`,
          );
        }

        this.registerAgent(agentClass.Name, {
          name: agentClass.Name,
          description: agentClass.Description,
        });
      } catch (error) {
        console.error(`Failed to process agent module:`, error);
      }
    }

    this.isInitialized = true;
  }

  private registerAgent(name: string, agentInfo: AgentInfo): void {
    this.agents.set(name, agentInfo);
  }

  async getAllAgents(): Promise<AgentInfo[]> {
    await this.initialize();
    return [...this.agents.values()];
  }

  async getAgentByName(name: string): Promise<AgentInfo | undefined> {
    await this.initialize();
    const agent = this.agents.get(name);
    return agent;
  }
}

export default new AgentService();
