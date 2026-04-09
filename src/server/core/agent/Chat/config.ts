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
            default: 'qwen3.5-27b',
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
      upload: {
        type: 'object',
        properties: {
          maxSize: {
            type: 'number',
            description: 'Maximum file size in bytes (e.g. 10485760 = 10MB)',
            default: 10485760, // 10MB
            nullable: true,
          },
          allowedTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed MIME types (e.g. image/*, application/pdf)',
            default: ['image/*', 'application/pdf', 'text/*'],
            nullable: true,
          },
          maxCount: {
            type: 'number',
            description: 'Maximum number of files per upload',
            default: 5,
            nullable: true,
          },
        },
        nullable: true,
      },
    },
  },
};
