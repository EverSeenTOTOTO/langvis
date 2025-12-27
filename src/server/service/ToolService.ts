import { globby } from 'globby';
import { container } from 'tsyringe';
import { service } from '../decorator/service';
import Logger from './logger';
import path from 'path';
import { registerTool } from '../decorator/config';
import { ToolConfig } from '@/shared/types';
import { Tool, ToolConstructor } from '../core/tool';
import { isProd } from '../utils';

@service()
export class ToolService {
  private readonly logger = Logger.child({ source: 'ConversationService' });

  private tools: string[] = [];
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  async getAllToolInfo() {
    await this.initialize();
    return this.tools.map(tool => ({
      id: tool,
      ...container.resolve<any>(tool)?.config,
    }));
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    try {
      const tools = await this.discoverTools();

      this.logger.info(
        `Discovered ${tools.length} tools:`,
        tools.map(a => a.clazz.name),
      );

      // Register tools
      this.tools = await Promise.all(
        tools.map(tool => registerTool(tool.clazz, tool.config)),
      );
    } catch (e) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize ToolService:', e);
    }
  }

  private async discoverTools() {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/core/tool/*/index${suffix}`;

    const toolPaths = await globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    });

    const tools: {
      clazz: ToolConstructor;
      config: ToolConfig;
    }[] = [];

    for (const absolutePath of toolPaths) {
      try {
        const [{ default: clazz }, { config }] = await Promise.all([
          import(absolutePath),
          import(path.resolve(path.dirname(absolutePath), `config${suffix}`)),
        ]);

        if (clazz && config) {
          tools.push({
            clazz,
            config,
          });
        } else {
          this.logger.warn(
            `Incomplete tool module at ${path.basename(absolutePath, suffix)}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to process tool module ${absolutePath}:`,
          error,
        );
      }
    }

    return tools;
  }

  async callTool(toolId: string, input: Record<string, any>): Promise<unknown> {
    await this.initialize();

    if (!this.tools.includes(toolId)) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    const tool = container.resolve<Tool>(toolId);
    return await tool.call(input);
  }
}
