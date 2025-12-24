import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.CHAT_AGENT,
  name: {
    en: 'ReAct Agent',
    zh: 'ReAct 智能体',
  },
  description: {
    en: 'An agent that uses the ReAct strategy to interact with tools and provide answers based on reasoning and actions.',
    zh: '使用 ReAct 策略与工具交互的智能体，基于推理和行动提供答案。',
  },
  tools: [ToolIds.DATE_TIME],
};
