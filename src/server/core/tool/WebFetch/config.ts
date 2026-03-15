import { ToolConfig } from '@/shared/types';

export type ResponseFormat = 'concise' | 'detailed';

export interface WebFetchInput {
  url: string;
  timeout?: number;
  retry?: number;
  response_format?: ResponseFormat;
}

export interface WebFetchOutputConcise {
  title: string;
  content: string;
}

export interface WebFetchOutputDetailed {
  title: string;
  content: string;
  excerpt: string;
  author: string | null;
  siteName: string | null;
  url: string;
}

export type WebFetchOutput = WebFetchOutputConcise | WebFetchOutputDetailed;

export const config: ToolConfig<WebFetchInput, WebFetchOutput> = {
  name: 'web_fetch',
  description: `Fetch and extract main content from a web page URL.

**Response formats:**
- \`concise\` (default): Returns only title and content. Use for most cases.
- \`detailed\`: Also includes excerpt, author, site name. Use when you need metadata.

**Common use cases:**
- Reading article content: use concise format
- Archiving documents: use concise format
- Extracting article metadata: use detailed format`,
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
      retry: {
        type: 'number',
        default: 0,
        description:
          'Number of retry attempts on failure. Default is 0 (no retry).',
        nullable: true,
      },
      response_format: {
        type: 'string',
        enum: ['concise', 'detailed'],
        default: 'concise',
        description:
          'Output format. "concise" returns only title+content. "detailed" includes all metadata.',
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
        description: 'The title of the article or page.',
      },
      content: {
        type: 'string',
        description: 'The main text content in markdown format.',
      },
      excerpt: {
        type: 'string',
        nullable: true,
        description:
          'A short excerpt or summary of the article (detailed only).',
      },
      author: {
        type: 'string',
        nullable: true,
        description: 'The author name (detailed only).',
      },
      siteName: {
        type: 'string',
        nullable: true,
        description: 'The name of the website or publication (detailed only).',
      },
      url: {
        type: 'string',
        nullable: true,
        description: 'The original URL that was fetched (detailed only).',
      },
    },
    required: ['title', 'content'],
  },
};
