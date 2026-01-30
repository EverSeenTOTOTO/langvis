import { AgentConfig } from '@/shared/types';

export const config: AgentConfig<{
  model?: {
    code: string;
    temperature?: number;
    topP?: number;
  };
}> = {
  name: 'Chat Agent',
  description:
    'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            default: 'gemini-2.5-flash',
          },
          temperature: {
            type: 'number',
            default: 0.7,
            minimum: 0,
            maximum: 1,
            nullable: true,
          },
          topP: {
            type: 'number',
            default: 0.7,
            minimum: 0,
            maximum: 1,
            nullable: true,
          },
        },
        required: ['code'],
        nullable: true,
      },
      memory: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['no_memory', 'chat_history_memory', 'enhanced_memory'],
            default: 'chat_history_memory',
          },
        },
      },
    },
  },
};
