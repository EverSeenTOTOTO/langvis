import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface ListToolsInput {
  query?: string;
}

export interface ListToolsOutput {
  tools: string;
  skills?: string;
}

export const config: ToolConfig<ListToolsInput, ListToolsOutput> = {
  name: 'list_tools',
  description:
    '查看所有可用工具和代理。当你需要执行某个操作但不确定有什么工具、或者需要详细查阅某工具的 input schema 时，调用此工具浏览。',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '可选关键词，用于过滤列表',
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
  compression: 'skip',
};

export const id = ToolIds.LIST_TOOLS;
