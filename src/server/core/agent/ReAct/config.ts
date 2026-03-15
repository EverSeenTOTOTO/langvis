import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.CHAT,
  name: 'ReAct Agent',
  description:
    'An agent that uses the ReAct strategy to interact with tools and provide answers based on reasoning and actions.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            default: 'qwen3.5-27b',
          },
        },
      },
    },
  } as any,
  tools: [
    ToolIds.DATETIME_GET,
    ToolIds.WEB_FETCH,
    ToolIds.ASK_USER,
    ToolIds.CACHED_READ,
  ],
};
