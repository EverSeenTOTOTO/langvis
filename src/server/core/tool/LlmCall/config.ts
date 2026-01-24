import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<{
  model?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}> = {
  name: 'LlmCall Tool',
  description: 'A tool to perform a single call of Llm.',
  inputSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        nullable: true,
        description:
          'The model to use for completion. Defaults to OPENAI_MODEL environment variable.',
      },
      temperature: {
        type: 'number',
        nullable: true,
        minimum: 0,
        maximum: 2,
        description:
          'Sampling temperature between 0 and 2. Higher values make output more random.',
      },
      top_p: {
        type: 'number',
        nullable: true,
        minimum: 0,
        maximum: 1,
        description: 'Nucleus sampling parameter. Alternative to temperature.',
      },
      stream: {
        type: 'boolean',
        nullable: true,
        default: false,
        description:
          'Whether to stream partial message deltas. Use streamCall method for streaming.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {},
  },
};
