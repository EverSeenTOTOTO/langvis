import { ToolConfig } from '@/shared/types';
import {
  DocumentCategory,
  DocumentMetadata,
  DocumentSourceType,
} from '@/shared/entities/Document';

export interface ArchiveInput {
  document: {
    title: string;
    summary: string;
    keywords: string[];
    category: DocumentCategory;
    metadata: DocumentMetadata;
    sourceUrl?: string;
    sourceType: DocumentSourceType;
    rawContent: string;
  };
  chunks: Array<{
    content: string;
    index: number;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface ArchiveOutput {
  documentId: string;
  chunkCount: number;
}

export const config: ToolConfig<ArchiveInput, ArchiveOutput> = {
  name: 'Archive Tool',
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
          keywords: { type: 'array', items: { type: 'string' } },
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
  },
  outputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string' },
      chunkCount: { type: 'number' },
    },
    required: ['documentId', 'chunkCount'],
  },
};
