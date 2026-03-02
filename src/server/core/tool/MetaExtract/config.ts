import { ToolConfig } from '@/shared/types';

export interface MetaExtractInput {
  content: string;
  sourceUrl?: string;
  sourceType?: string;
}

export interface MetaExtractOutput {
  title: string;
  summary: string;
  keywords: string[];
  category: string;
  metadata: Record<string, unknown>;
}

export const config: ToolConfig<MetaExtractInput, MetaExtractOutput> = {
  name: 'Meta Extract Tool',
  description:
    'Extract metadata from document content including title, summary, keywords, category, and dynamic metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The document content to analyze',
      },
      sourceUrl: {
        type: 'string',
        nullable: true,
        description: 'The source URL of the document (helpful for context)',
      },
      sourceType: {
        type: 'string',
        nullable: true,
        description: 'The source type (web, file, text)',
      },
    },
    required: ['content'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The document title',
      },
      summary: {
        type: 'string',
        description: 'A one-sentence summary (max 50 chars)',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords extracted from the document',
      },
      category: {
        type: 'string',
        description:
          'Document category: tech_blog, social_media, paper, documentation, news, other',
      },
      metadata: {
        type: 'object',
        description: 'Dynamic metadata based on category',
      },
    },
    required: ['title', 'summary', 'keywords', 'category', 'metadata'],
  },
};
