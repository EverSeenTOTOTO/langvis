import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { ToolService } from '../../../service/ToolService';
import { inject, container } from 'tsyringe';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import type { ListToolsInput, ListToolsOutput } from './config';

const CORE_TOOLS = new Set([
  ToolIds.ASK_USER,
  ToolIds.CACHED_READ,
  ToolIds.AGENT_CALL,
  ToolIds.LIST_TOOLS,
]);

@tool(ToolIds.LIST_TOOLS)
export default class ListToolsTool extends Tool<
  ListToolsInput,
  ListToolsOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(ToolService) private toolService: ToolService) {
    super();
  }

  async *call(
    @input() { query }: ListToolsInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ListToolsOutput, void> {
    ctx.signal.throwIfAborted();

    const allTools = await this.toolService.getAllToolInfo();
    const filtered = allTools.filter(t => {
      if (CORE_TOOLS.has(t.id)) return false;

      if (!query) return true;

      const keywords = query.toLowerCase().split(/\s+/);
      const hay = `${t.id} ${t.name} ${t.description ?? ''}`.toLowerCase();
      return keywords.some(k => hay.includes(k));
    });

    const toolInstances = filtered
      .map(t => {
        try {
          return container.resolve<Tool>(t.id);
        } catch {
          return null;
        }
      })
      .filter((t): t is Tool => t !== null);

    const markdown = formatToolsToMarkdown(toolInstances);

    return { tools: markdown };
  }
}
