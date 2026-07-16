import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { inject } from 'tsyringe';
import type { SkillCallInput, SkillCallOutput } from './config';

@tool(ToolIds.SKILL_CALL)
export default class SkillCallTool extends Tool<SkillCallOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(SkillService) private skillService: SkillService) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<never, SkillCallOutput, void> {
    ctx.signal.throwIfAborted();

    const { skillId } = ctx.input as unknown as SkillCallInput;

    const content = await this.skillService.getSkillContent(skillId);

    if (!content) {
      return {
        content: `Skill '${skillId}' not found. Use list_tools to see available skills.`,
      };
    }

    return { content };
  }
}
