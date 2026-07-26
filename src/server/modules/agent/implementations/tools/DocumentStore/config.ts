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
    rawFile?: string;
  };
}

export interface DocumentStoreOutput {
  documentId: string;
  chunkCount: number;
}

export const config: ToolConfig<DocumentStoreInput, DocumentStoreOutput> = {
  name: 'DocumentStore Tool',
  description:
    'Store a document to the database. Chunking and embeddings are both handled internally — the caller passes the document with either rawContent (full text) or rawFile (filename in workDir of an offloaded large fetch).',
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
          rawContent: {
            type: 'string',
            nullable: true,
            description: 'Full document text. Omit if passing rawFile instead.',
          },
          rawFile: {
            type: 'string',
            nullable: true,
            description:
              'Filename in workDir holding the full content (e.g. an offloaded web_fetch/email result). Takes precedence over rawContent — the tool reads the file itself, avoiding loading the full text into context.',
          },
        },
        required: [
          'title',
          'summary',
          'keywords',
          'category',
          'metadata',
          'sourceType',
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
