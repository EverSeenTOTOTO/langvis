import { singleton, container, Lifecycle } from 'tsyringe';
import { globby } from 'globby';
import path from 'path';
import { fileURLToPath } from 'url';
import { AGENT_META, ENTITY_TYPES } from '@/shared/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AgentInfo = {
  name: string;
  description: string;
  type: typeof ENTITY_TYPES.TOOL | typeof ENTITY_TYPES.AGENT;
};

interface EntityClass {
  Name: string;
  Description: string;
  new (...args: any[]): any;
}

interface EntityMeta {
  Name: { en: string };
  Description: { en: string };
  Type: typeof ENTITY_TYPES.TOOL | typeof ENTITY_TYPES.AGENT;
}

interface EntityToRegister {
  class: EntityClass;
  meta: EntityMeta;
}

@singleton()
export class AgentService {
  private readonly agents = new Map<string, AgentInfo>();
  private isInitialized = false;

  async getAllAgents(): Promise<AgentInfo[]> {
    await this.initialize();
    return [...this.agents.values()].filter(
      agent => agent.type === ENTITY_TYPES.AGENT,
    );
  }

  async getAgentByName(name: string): Promise<AgentInfo | undefined> {
    await this.initialize();
    const agent = this.agents.get(name);
    return agent?.type === ENTITY_TYPES.AGENT ? agent : undefined;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const entities = await this.discoverEntities();
    const toolInstances = await this.registerTools(entities);
    await this.registerAgents(entities, toolInstances);

    this.isInitialized = true;
  }

  private async discoverEntities(): Promise<EntityToRegister[]> {
    const agentPaths = await this.getEntityPaths();
    const entities: EntityToRegister[] = [];

    for (const absolutePath of agentPaths) {
      try {
        const entity = await this.loadEntity(absolutePath);
        if (entity) {
          entities.push(entity);
        }
      } catch (error) {
        console.error(`Failed to process agent module ${absolutePath}:`, error);
      }
    }

    return entities;
  }

  private async getEntityPaths(): Promise<string[]> {
    return globby('../core/agent/*/index.ts', {
      cwd: __dirname,
      absolute: true,
    });
  }

  private async loadEntity(
    absolutePath: string,
  ): Promise<EntityToRegister | null> {
    const relativePath = path.relative(__dirname, absolutePath);
    const entityDirName = this.extractEntityDirName(relativePath);

    if (entityDirName === 'agent') return null;

    const module = await import(absolutePath);
    const entityClass = module.default as EntityClass;

    this.validateEntityClass(entityClass, relativePath);

    const metaData = this.findEntityMeta(entityClass.Name);
    if (!metaData) {
      console.warn(`No metadata found for entity ${entityClass.Name}`);
      return null;
    }

    return { class: entityClass, meta: metaData };
  }

  private extractEntityDirName(relativePath: string): string {
    const pathParts = relativePath.split(path.sep);
    return pathParts[pathParts.length - 2];
  }

  private validateEntityClass(
    entityClass: any,
    relativePath: string,
  ): asserts entityClass is EntityClass {
    if (!entityClass) {
      throw new Error(`No default export found in module ${relativePath}`);
    }

    if (!entityClass.Name) {
      throw new Error(
        `Entity class in ${relativePath} is missing static Name property`,
      );
    }

    if (!entityClass.Description) {
      throw new Error(
        `Entity class in ${relativePath} is missing static Description property`,
      );
    }
  }

  private findEntityMeta(entityName: string): EntityMeta | null {
    const metaKey = Object.keys(AGENT_META).find(
      key => AGENT_META[key].Name.en === entityName,
    );
    return metaKey ? AGENT_META[metaKey] : null;
  }

  private async registerTools(
    entities: EntityToRegister[],
  ): Promise<unknown[]> {
    const toolInstances: unknown[] = [];

    const tools = entities.filter(
      entity => entity.meta.Type === ENTITY_TYPES.TOOL,
    );

    for (const tool of tools) {
      this.registerEntityInContainer(tool.class, tool.meta);
      this.registerAgentInfo(tool.class, tool.meta);

      try {
        const instance = container.resolve(tool.class);
        toolInstances.push(instance);
      } catch (error) {
        console.error(
          `Failed to resolve tool instance ${tool.class.Name}:`,
          error,
        );
      }
    }

    return toolInstances;
  }

  private async registerAgents(
    entities: EntityToRegister[],
    toolInstances: unknown[],
  ): Promise<void> {
    const agents = entities.filter(
      entity => entity.meta.Type === ENTITY_TYPES.AGENT,
    );

    for (const agent of agents) {
      this.registerEntityInContainer(agent.class, agent.meta, toolInstances);
      this.registerAgentInfo(agent.class, agent.meta);
    }
  }

  private registerEntityInContainer(
    entityClass: EntityClass,
    metaData: EntityMeta,
    toolInstances?: unknown[],
  ): void {
    const registrationName = entityClass.Name;

    container.register(registrationName, entityClass, {
      lifecycle: Lifecycle.Singleton,
    });

    if (metaData.Type === ENTITY_TYPES.TOOL) {
      container.register(ENTITY_TYPES.TOOL, entityClass, {
        lifecycle: Lifecycle.Singleton,
      });
    }

    if (metaData.Type === ENTITY_TYPES.AGENT && toolInstances) {
      this.setupToolInjection(registrationName, toolInstances);
    }
  }

  private setupToolInjection(
    registrationName: string,
    toolInstances: unknown[],
  ): void {
    container.afterResolution(
      registrationName,
      (_token, instance: object) => {
        if (instance && 'tools' in instance) {
          Reflect.set(instance, 'tools', toolInstances);
        }
      },
      { frequency: 'Always' },
    );
  }

  private registerAgentInfo(
    entityClass: EntityClass,
    metaData: EntityMeta,
  ): void {
    const agentInfo: AgentInfo = {
      name: entityClass.Name,
      description: entityClass.Description,
      type: metaData.Type,
    };

    this.agents.set(entityClass.Name, agentInfo);
  }
}
