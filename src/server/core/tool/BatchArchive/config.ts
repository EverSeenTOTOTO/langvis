import { ToolConfig } from '@/shared/types';

export interface BatchArchiveInput {
  urls: string[];
  /** Timeout in milliseconds for each URL (default: 120000 = 2 minutes) */
  timeout?: number;
}

export interface ArchiveResult {
  url: string;
  status: 'success' | 'failed';
  documentId?: string;
  title?: string;
  error?: string;
}

export interface BatchArchiveOutput {
  total: number;
  succeeded: number;
  failed: number;
  results: ArchiveResult[];
}

export interface BatchArchiveProgress {
  current: number;
  total: number;
  url: string;
  status: 'processing' | 'success' | 'failed';
  documentId?: string;
  title?: string;
  error?: string;
}

export const config: ToolConfig<BatchArchiveInput, BatchArchiveOutput> = {
  name: 'Batch Archive Tool',
  description:
    'Archive multiple URLs in batch. Fetches content from each URL and archives them sequentially. Yields progress events for each URL processed.',
  inputSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of URLs to archive',
      },
      timeout: {
        type: 'number',
        nullable: true,
        description:
          'Timeout in milliseconds for each URL (default: 120000 = 2 minutes)',
      },
    },
    required: ['urls'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      total: { type: 'number' },
      succeeded: { type: 'number' },
      failed: { type: 'number' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            status: { type: 'string' },
            documentId: { type: 'string', nullable: true },
            title: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
          },
          required: ['url', 'status'],
        },
      },
    },
    required: ['total', 'succeeded', 'failed', 'results'],
  },
};
