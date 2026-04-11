import { AgentConfig } from '@/shared/types';

export const config: AgentConfig<{
  model?: {
    modelId: string;
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
          modelId: {
            type: 'string',
            format: 'model-select',
            modelType: 'chat',
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
        required: ['modelId'],
        nullable: true,
      },
      memory: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['slide_window_memory'],
            default: 'slide_window_memory',
          },
          windowSize: {
            type: 'integer',
            minimum: 1,
            default: 10,
            description: 'Number of conversation turns to keep in memory',
          },
        },
      },
      upload: {
        type: 'object',
        properties: {
          maxSize: {
            type: 'number',
            description: 'Maximum file size in bytes (e.g. 10485760 = 10MB)',
            default: 10485760,
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
