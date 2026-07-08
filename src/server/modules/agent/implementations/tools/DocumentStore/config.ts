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
}

export interface DocumentStoreOutput {
  documentId: string;
  chunkCount: number;
}

export const config: ToolConfig<DocumentStoreInput, DocumentStoreOutput> = {
  name: 'DocumentStore Tool',
  description:
    'Store a document to the database. Chunking and embeddings are both handled internally — the caller only passes the document (with rawContent).',
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
    },
    required: ['document'],
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
