import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { inject, container } from 'tsyringe';
import {
  formatToolsToMarkdown,
  formatSkillsToMarkdown,
} from '@/server/utils/formatTools';
import type { ListToolsInput, ListToolsOutput } from './config';

@tool(ToolIds.LIST_TOOLS)
export default class ListToolsTool extends Tool<ListToolsOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(ToolService) private toolService: ToolService,
    @inject(SkillService) private skillService: SkillService,
  ) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<never, ListToolsOutput, void> {
    ctx.signal.throwIfAborted();

    const { query } = ctx.input as ListToolsInput;

    const keywords = query?.toLowerCase().split(/\s+/);

    const matchFilter = (text: string) => {
      if (!keywords) return true;
      const hay = text.toLowerCase();
      return keywords.some(k => hay.includes(k));
    };

    // Tools — exclude only list_tools itself
    const allTools = await this.toolService.getAllToolInfo();
    const filteredTools = allTools.filter(t => {
      if (t.id === ToolIds.LIST_TOOLS) return false;
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

    const allSkills = await this.skillService.getAllSkillInfo();
    const filteredSkills = allSkills.filter(s => {
      return matchFilter(`${s.id} ${s.name} ${s.description ?? ''}`);
    });

    return {
      tools: formatToolsToMarkdown(toolInstances, { detail: true }),
      skills: formatSkillsToMarkdown(filteredSkills),
    };
  }
}
