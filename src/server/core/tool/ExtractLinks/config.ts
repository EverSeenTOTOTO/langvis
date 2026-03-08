import { ToolConfig } from '@/shared/types';

export interface LinkInfo {
  url: string;
  text: string;
  context: string;
}

export interface ExtractLinksInput {
  content: string;
}

export interface ExtractLinksOutput {
  links: LinkInfo[];
}

export const config: ToolConfig<ExtractLinksInput, ExtractLinksOutput> = {
  name: 'Extract Links Tool',
  description:
    'Extract HTTP/HTTPS links from text or HTML content. Returns a list of URLs with their anchor text and surrounding context.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The text or HTML content to extract links from',
      },
    },
    required: ['content'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            text: { type: 'string' },
            context: { type: 'string' },
          },
          required: ['url', 'text', 'context'],
        },
      },
    },
    required: ['links'],
  },
};
