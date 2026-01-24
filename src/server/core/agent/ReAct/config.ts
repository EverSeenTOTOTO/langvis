import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.CHAT,
  name: 'ReAct Agent',
  description:
    'An agent that uses the ReAct strategy to interact with tools and provide answers based on reasoning and actions.',
  tools: [ToolIds.DATE_TIME, ToolIds.WEB_FETCH],
};
