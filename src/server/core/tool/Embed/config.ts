import { ToolConfig } from '@/shared/types';

export interface EmbedInput {
  chunks: Array<{
    content: string;
    index: number;
    metadata?: Record<string, unknown>;
  }>;
  model?: string;
  /** Timeout in milliseconds (default: 60000 = 1 minute) */
  timeout?: number;
}

export interface EmbedOutput {
  chunks: Array<{
    content: string;
    index: number;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>;
  model: string;
  dimension: number;
}

export const config: ToolConfig<EmbedInput, EmbedOutput> = {
  name: 'Embed Tool',
  description:
    'Generate embeddings for text chunks using OpenAI embedding API.',
  inputSchema: {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            index: { type: 'number' },
            metadata: { type: 'object', nullable: true },
          },
          required: ['content', 'index'],
        },
        description: 'Array of text chunks to embed',
      },
      model: {
        type: 'string',
        nullable: true,
        description:
          'Embedding model to use. Defaults to text-embedding-3-small',
      },
      timeout: {
        type: 'number',
        nullable: true,
        description: 'Timeout in milliseconds (default: 60000 = 1 minute)',
      },
    },
    required: ['chunks'],
  } as any,
  outputSchema: {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            index: { type: 'number' },
            embedding: { type: 'array', items: { type: 'number' } },
            metadata: { type: 'object', nullable: true },
          },
          required: ['content', 'index', 'embedding'],
        },
      },
      model: { type: 'string' },
      dimension: { type: 'number' },
    },
    required: ['chunks', 'model', 'dimension'],
  } as any,
};
