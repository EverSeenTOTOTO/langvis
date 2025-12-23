import { readFile } from 'fs/promises';
import { globby } from 'globby';
import { dirname, resolve } from 'path';
import { container, Lifecycle, singleton } from 'tsyringe';
import { Tool, ToolConstructor } from '../core/tool';
import { logger } from '../middleware/logger';

export interface ToolMeta {
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
}

export type ToolInfo = {
  name: string;
  description: string;
};

@singleton()
export class ToolService {
  private readonly tools = new Map<string, ToolInfo>();
  private isInitialized = false;

  constructor() {
    this.initialize().catch(error => {
      this.isInitialized = false;
      logger.error('❌ Failed to initialize ToolService:', error);
    });
  }

  async getAllToolInfo(): Promise<ToolInfo[]> {
    await this.initialize();
    return [...this.tools.values()];
  }

  async getToolsByNames(toolNames: string[]): Promise<Tool[]> {
    await this.initialize();
    return toolNames.map(name => container.resolve<Tool>(name));
  }

  async callTool(
    toolName: string,
    input: Record<string, any>,
  ): Promise<unknown> {
    await this.initialize();

    if (!this.tools.has(toolName)) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const tool = container.resolve<Tool>(toolName);
    return await tool.call(input);
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    const tools = await this.discoverTools();

    logger.info(
      `🔧 Discovered ${tools.length} tools:`,
      tools.map(t => t.class.name),
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

      const toolInfo = {
        name: tool.meta.name.en,
        description: tool.meta.description.en,
      };
      this.tools.set(toolName, toolInfo);

      logger.info(`✅ Tool registered successfully: ${toolName}`);
    });
  }

  private async discoverTools() {
    const pattern = './src/server/core/tool/*/index.ts';

    const toolPaths = await globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    });

    const tools: {
      class: ToolConstructor;
      meta: ToolMeta;
    }[] = [];

    for (const absolutePath of toolPaths) {
      try {
        const tool = await this.loadTool(absolutePath);
        if (tool) {
          tools.push(tool);
        }
      } catch (error) {
        logger.error(
          `❌ Failed to process tool module ${absolutePath}:`,
          error,
        );
      }
    }

    return tools;
  }

  private async loadTool(absolutePath: string) {
    const module = await import(absolutePath);
    const toolClass = module.default;

    if (!toolClass) {
      logger.warn(`⚠️ No default export found in: ${absolutePath}`);
      return null;
    }

    // Read config.json from the same directory
    const configPath = resolve(dirname(absolutePath), 'config.json');
    let metaData: ToolMeta;

    try {
      const configContent = await readFile(configPath, 'utf-8');
      metaData = JSON.parse(configContent);
    } catch (error) {
      logger.warn(
        `❌ No config.json found for tool at ${absolutePath}:`,
        error,
      );
      return null;
    }

    return { class: toolClass, meta: metaData };
  }
}
