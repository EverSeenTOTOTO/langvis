import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    url: string;
    timeout?: number;
  },
  {
    title?: string;
    textContent?: string;
    excerpt?: string;
    byline?: string;
    siteName?: string;
    url: string;
  }
> = {
  name: 'Web Fetch Tool',
  description: 'A tool to fetch and extract content from web pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'The URL of the web page to fetch. Must be a valid HTTP/HTTPS URL.',
      },
      timeout: {
        type: 'number',
        default: 30000,
        description:
          'Request timeout in milliseconds. Default is 30000 (30 seconds).',
        nullable: true,
      },
    },
    required: ['url'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        nullable: true,
        description: 'The title of the article or page.',
      },
      textContent: {
        type: 'string',
        nullable: true,
        description:
          'The main text content of the article, with HTML tags removed.',
      },
      excerpt: {
        type: 'string',
        nullable: true,
        description: 'A short excerpt or summary of the article.',
      },
      byline: {
        type: 'string',
        nullable: true,
        description: 'The author or attribution information.',
      },
      siteName: {
        type: 'string',
        nullable: true,
        description: 'The name of the website or publication.',
      },
      url: {
        type: 'string',
        description: 'The original URL that was fetched.',
      },
    },
    required: ['url'],
  },
};
