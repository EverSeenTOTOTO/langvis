import { ToolConfig } from '@/shared/types';

export type ContentChunkStrategy = 'paragraph' | 'fixed';

export interface ContentChunkOptions {
  maxContentChunkSize?: number;
  minContentChunkSize?: number;
  overlap?: number;
}

export interface ContentChunkInput {
  content: string;
  strategy?: ContentChunkStrategy;
  options?: ContentChunkOptions;
}

export interface ContentChunkItem {
  content: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface ContentChunkOutput {
  chunks: ContentChunkItem[];
}

export const config: ToolConfig<ContentChunkInput, ContentChunkOutput> = {
  name: 'ContentChunk Tool',
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
        description: 'ContentChunking strategy. Defaults to "paragraph"',
      },
      options: {
        type: 'object',
        nullable: true,
        properties: {
          maxContentChunkSize: {
            type: 'number',
            nullable: true,
            description: 'Maximum chunk size in characters. Defaults to 1000',
          },
          minContentChunkSize: {
            type: 'number',
            nullable: true,
            description:
              'Minimum chunk size in characters. Small final chunks are merged into the previous one. Defaults to 200',
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
