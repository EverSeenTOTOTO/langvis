import { ToolConfig } from '@/shared/types';
import {
  DocumentCategory,
  DocumentMetadata,
  DocumentSourceType,
} from '@/shared/entities/Document';

export interface DocumentStoreInput {
  document: {
    title: string;
    summary: string;
    keywords: string[] | string;
    category: DocumentCategory;
    metadata: DocumentMetadata;
    sourceUrl?: string;
    sourceType: DocumentSourceType;
    rawContent: string;
  };
  chunks: Array<{
    content: string;
    index: number;
    metadata?: Record<string, unknown>;
  }>;
  /** 与 chunks 同序、按位对齐（长度不等会在入口失败）。 */
  embeddings: number[][];
}

export interface DocumentStoreOutput {
  documentId: string;
  chunkCount: number;
}

export const config: ToolConfig<DocumentStoreInput, DocumentStoreOutput> = {
  name: 'DocumentStore Tool',
  description:
    'Store document metadata and chunked content with embeddings to database.',
  inputSchema: {
    type: 'object',
    properties: {
      document: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          keywords: {
            anyOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' },
            ],
          },
          category: { type: 'string' },
          metadata: { type: 'object' },
          sourceUrl: { type: 'string', nullable: true },
          sourceType: { type: 'string' },
          rawContent: { type: 'string' },
        },
        required: [
          'title',
          'summary',
          'keywords',
          'category',
          'metadata',
          'sourceType',
          'rawContent',
        ],
      },
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
    },
    required: ['document', 'chunks'],
  } as any,
  outputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string' },
      chunkCount: { type: 'number' },
    },
    required: ['documentId', 'chunkCount'],
  },
};
