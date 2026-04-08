import { ToolConfig } from '@/shared/types';

export interface RetrieveInput {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface RetrieveResult {
  chunkId: string;
  content: string;
  similarity: number;
  document: {
    id: string;
    title: string;
    category: string;
    sourceUrl?: string;
  };
}

export interface RetrieveOutput {
  results: RetrieveResult[];
}

export const config: ToolConfig<RetrieveInput, RetrieveOutput> = {
  name: 'Retrieve Tool',
  untrustedOutput: true,
  description:
    'Semantic search for document chunks based on query text using vector similarity.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query text',
      },
      limit: {
        type: 'number',
        nullable: true,
        description: 'Maximum number of results to return. Defaults to 10',
      },
      threshold: {
        type: 'number',
        nullable: true,
        description:
          'Minimum similarity threshold (0-1). Defaults to no filter',
      },
    },
    required: ['query'],
  } as any,
  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chunkId: { type: 'string' },
            content: { type: 'string' },
            similarity: { type: 'number' },
            document: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                category: { type: 'string' },
                sourceUrl: { type: 'string', nullable: true },
              },
              required: ['id', 'title', 'category'],
            },
          },
          required: ['chunkId', 'content', 'similarity', 'document'],
        },
      },
    },
    required: ['results'],
  } as any,
};
