import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface SkillCallInput {
  skillId: string;
}

export interface SkillCallOutput {
  content: string;
}

export const config: ToolConfig<SkillCallInput, SkillCallOutput> = {
  name: 'skill_call',
  description: '加载指定skill的工作流指导内容，获取后按照指导执行后续操作。',
  inputSchema: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: '技能ID，可通过 list_tools 查看所有可用技能',
      },
    },
    required: ['skillId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '技能的工作流指导内容',
      },
    },
    required: ['content'],
  },
  compression: 'skip',
};

export const id = ToolIds.SKILL_CALL;
