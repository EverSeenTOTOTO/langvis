import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { ToolService } from '../../../service/ToolService';
import { AgentService } from '../../../service/AgentService';
import { inject, container } from 'tsyringe';
import {
  formatToolsToMarkdown,
  formatAgentsToMarkdown,
} from '@/server/utils/formatTools';
import type { Agent } from '../../agent';
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

  constructor(
    @inject(ToolService) private toolService: ToolService,
    @inject(AgentService) private agentService: AgentService,
  ) {
    super();
  }

  async *call(
    @input() { query }: ListToolsInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ListToolsOutput, void> {
    ctx.signal.throwIfAborted();

    const keywords = query?.toLowerCase().split(/\s+/);

    const matchFilter = (text: string) => {
      if (!keywords) return true;
      const hay = text.toLowerCase();
      return keywords.some(k => hay.includes(k));
    };

    // Tools
    const allTools = await this.toolService.getAllToolInfo();
    const filteredTools = allTools.filter(t => {
      if (CORE_TOOLS.has(t.id)) return false;
      return matchFilter(`${t.id} ${t.name} ${t.description ?? ''}`);
    });

    const toolInstances = filteredTools
      .map(t => {
        try {
          return container.resolve<Tool>(t.id);
        } catch {
          return null;
        }
      })
      .filter((t): t is Tool => t !== null);

    // Agents
    const allAgents = await this.agentService.getAllAgentInfo();
    const filteredAgents = allAgents.filter(a => {
      if (CORE_TOOLS.has(a.id)) return false;
      return matchFilter(`${a.id} ${a.name} ${a.description ?? ''}`);
    });

    const agentInstances = filteredAgents
      .map(a => {
        try {
          return container.resolve<Agent>(a.id);
        } catch {
          return null;
        }
      })
      .filter((a): a is Agent => a !== null);

    return {
      tools: formatToolsToMarkdown(toolInstances),
      agents:
        agentInstances.length > 0
          ? formatAgentsToMarkdown(agentInstances)
          : undefined,
    };
  }
}
