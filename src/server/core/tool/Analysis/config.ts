import { ToolConfig } from '@/shared/types';
import { DocumentSourceType } from '@/shared/entities/Document';

export interface AnalysisInput {
  content: string;
  sourceUrl?: string;
  sourceType: DocumentSourceType;
  metadata?: Record<string, unknown>;
}

export interface AnalysisOutput {
  documentId: string;
  title: string;
  category: string;
  chunkCount: number;
}

export const config: ToolConfig<AnalysisInput, AnalysisOutput> = {
  name: 'Analysis Tool',
  description:
    'Complete document archiving pipeline: extract metadata, chunk content, generate embeddings, and store to database.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The document content to archive',
      },
      sourceUrl: {
        type: 'string',
        nullable: true,
        description: 'The source URL of the document',
      },
      sourceType: {
        type: 'string',
        description: 'The source type (web, file, text)',
      },
      metadata: {
        type: 'object',
        nullable: true,
        description: 'Additional metadata to include',
      },
    },
    required: ['content', 'sourceType'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string' },
      title: { type: 'string' },
      category: { type: 'string' },
      chunkCount: { type: 'number' },
    },
    required: ['documentId', 'title', 'category', 'chunkCount'],
  },
};
