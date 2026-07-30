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

    const { keywords, tool: toolArg } = ctx.input as ListToolsInput;

    // 完整模式：指定具体 tool，展开其完整参数定义
    const toolId = toolArg?.trim();
    if (toolId) {
      const resolved = await this.resolveToolById(toolId);
      return {
        tools: resolved
          ? formatToolsToMarkdown([resolved], { detail: true })
          : `Tool not found: \`${toolId}\`.`,
      };
    }

    // 精简模式：按 keywords 过滤
    const { tools, skills } = await retrieveRelevantTools(
      this.toolService,
      this.skillService,
      keywords,
      { excludeToolIds: [ToolIds.LIST_TOOLS] },
    );

    return {
      tools: formatToolsToMarkdown(tools, { detail: false }),
      skills: formatSkillsToMarkdown(skills),
    };
  }

  /** 精确 id 优先，回退到 id/name 子串包含。 */
  private async resolveToolById(id: string): Promise<Tool | undefined> {
    const term = id.toLowerCase();
    const all = await this.toolService.getAllToolInfo();
    const match =
      all.find(t => t.id.toLowerCase() === term) ??
      all.find(
        t =>
          t.id.toLowerCase().includes(term) ||
          (t.name ?? '').toLowerCase().includes(term),
      );
    if (!match) return undefined;
    return this.toolService.resolve(match.id);
  }
}
