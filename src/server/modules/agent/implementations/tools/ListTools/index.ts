import { inject } from 'tsyringe';
import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import {
  formatToolsToMarkdown,
  formatSkillsToMarkdown,
} from '@/server/utils/formatTools';
import { retrieveRelevantTools } from '@/server/utils/tool-retrieval';
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

    const { tools, skills } = await retrieveRelevantTools(
      this.toolService,
      this.skillService,
      query,
      { excludeToolIds: [ToolIds.LIST_TOOLS] },
    );

    return {
      tools: formatToolsToMarkdown(tools, { detail: true }),
      skills: formatSkillsToMarkdown(skills),
    };
  }
}
