import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface ListToolsInput {
  keywords?: string;
  tool?: string;
}

export interface ListToolsOutput {
  tools: string;
  skills?: string;
}

export const config: ToolConfig<ListToolsInput, ListToolsOutput> = {
  name: 'list_tools',
  description:
    '查看可用工具和技能。两种输出模式：提供 keywords 过滤列表时为精简模式（仅 id/描述概要）；提供具体 tool（工具 id）时为完整模式，展开该工具的完整 input schema（含枚举值/默认值/取值范围）。两者同给时以 tool 为准（完整模式）。',
  inputSchema: {
    type: 'object',
    properties: {
      keywords: {
        type: 'string',
        description: '可选关键词，用于过滤工具/技能列表；提供时为精简模式',
      },
      tool: {
        type: 'string',
        description:
          '指定工具 id，查阅其完整参数定义（完整模式）；覆盖 keywords',
      },
    },
  } as any,
  outputSchema: {
    type: 'object',
    properties: {
      tools: {
        type: 'string',
        description: '可用工具的描述列表',
      },
      skills: {
        type: 'string',
        nullable: true,
        description: '可用技能的描述列表',
      },
    },
    required: ['tools'],
  } as any,
};

export const id = ToolIds.LIST_TOOLS;
