import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export const config: ToolConfig<
  {
    key: string;
    offset?: number;
    limit?: number;
  },
  string
> = {
  name: 'read_cache',
  description:
    'Read cached content. Use when a tool returns an object with $cached field.',
  skipCompression: true,
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The $cached value from the cached reference object',
      },
      offset: {
        type: 'number',
        nullable: true,
        description:
          'Starting position for reading (optional), useful for reading large content in chunks',
      },
      limit: {
        type: 'number',
        nullable: true,
        description:
          'Maximum length to read (optional), defaults to full content',
      },
    },
    required: ['key'],
  },
};

export const id = ToolIds.READ_CACHE;
