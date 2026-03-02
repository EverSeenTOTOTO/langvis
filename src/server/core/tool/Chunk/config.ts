import { ToolConfig } from '@/shared/types';

export type ChunkStrategy = 'paragraph' | 'fixed';

export interface ChunkOptions {
  maxChunkSize?: number;
  overlap?: number;
}

export interface ChunkInput {
  content: string;
  strategy?: ChunkStrategy;
  options?: ChunkOptions;
}

export interface ChunkItem {
  content: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkOutput {
  chunks: ChunkItem[];
}

export const config: ToolConfig<ChunkInput, ChunkOutput> = {
  name: 'Chunk Tool',
  description:
    'Split document content into chunks using different strategies (paragraph or fixed).',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The document content to chunk',
      },
      strategy: {
        type: 'string',
        enum: ['paragraph', 'fixed'],
        nullable: true,
        description: 'Chunking strategy. Defaults to "paragraph"',
      },
      options: {
        type: 'object',
        nullable: true,
        properties: {
          maxChunkSize: {
            type: 'number',
            nullable: true,
            description: 'Maximum chunk size in characters. Defaults to 1000',
          },
          overlap: {
            type: 'number',
            nullable: true,
            description: 'Overlap between chunks in characters. Defaults to 0',
          },
        },
      },
    },
    required: ['content'],
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
            metadata: { type: 'object', nullable: true },
          },
          required: ['content', 'index'],
        },
      },
    },
    required: ['chunks'],
  } as any,
};
