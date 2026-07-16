import { globby } from 'globby';
import { container } from 'tsyringe';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import path from 'path';
import { registerTool } from '@/server/decorator/tool';
import { ToolConfig } from '@/shared/types';
import type { ToolConstructor } from '../../domain/model/tool.base';
import { isProd } from '@/server/utils/env';

@service()
export class ToolService {
  private readonly logger = Logger.child({ source: 'ToolService' });

  private tools: string[] = [];
  private isInitialized = false;

  async getAllToolInfo() {
    await this.initialize();
    return this.tools.map(tool => ({
      id: tool,
      ...container.resolve<any>(tool)?.config,
    }));
  }

  getCachedToolIds(): string[] {
    return this.tools;
  }

  async initialize(): Promise<void> {
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
    const pattern = `./${isProd ? 'dist' : 'src'}/server/modules/agent/implementations/tools/*/index${suffix}`;

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
          `Failed to load tool module ${absolutePath}:`,
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
        );
      }
    }

    return tools;
  }
}
