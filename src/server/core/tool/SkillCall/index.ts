import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { SkillService } from '../../../service/SkillService';
import { inject } from 'tsyringe';
import type { SkillCallInput, SkillCallOutput } from './config';

@tool(ToolIds.SKILL_CALL)
export default class SkillCallTool extends Tool<
  SkillCallInput,
  SkillCallOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(SkillService) private skillService: SkillService) {
    super();
  }

  async *call(
    @input() { skillId }: SkillCallInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, SkillCallOutput, void> {
    ctx.signal.throwIfAborted();

    const content = await this.skillService.getSkillContent(skillId);

    if (!content) {
      return {
        content: `Skill '${skillId}' not found. Use list_tools to see available skills.`,
      };
    }

    return { content };
  }
}
