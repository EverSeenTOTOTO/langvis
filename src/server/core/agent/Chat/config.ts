import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  name: {
    en: 'Chat Agent',
    zh: '对话智能体',
  },
  description: {
    en: 'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
    zh: '与用户进行自然对话的会话智能体，维护对话历史和上下文以提供连贯的回应。',
  },
  configItems: [
    {
      type: 'group',
      name: 'model',
      label: {
        en: 'Model Settings',
        zh: '模型设置',
      },
      children: [
        {
          type: 'text',
          label: {
            en: 'Model Code',
            zh: '模型Code',
          },
          name: 'code',
          required: true,
          span: 24,
          initialValue: 'gemini-2.5-flash',
        },
        {
          type: 'number',
          label: {
            en: 'Temperature',
            zh: '温度',
          },
          name: 'temperature',
          initialValue: 0.7,
          span: 12,
          min: 0,
          max: 1,
          step: 0.1,
        },
        {
          type: 'number',
          label: {
            en: 'TopP',
            zh: 'TopP',
          },
          name: 'topP',
          initialValue: 0.7,
          span: 12,
          min: 0,
          max: 1,
          step: 0.1,
        },
      ],
    },
  ],
};
