import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
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
    toolCall: ToolCall,
  ): AsyncGenerator<never, SkillCallOutput, void> {
    toolCall.signal.throwIfAborted();

    const { skillId } = toolCall.input as unknown as SkillCallInput;

    const content = await this.skillService.getSkillContent(skillId);

    if (!content) {
      return {
        content: `Skill '${skillId}' not found. Use list_tools to see available skills.`,
      };
    }

    return { content };
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const skillId = typeof args.skillId === 'string' ? args.skillId : '';
    return `(${skillId})`;
  }
}
