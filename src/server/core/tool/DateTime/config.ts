import { ToolConfig } from '@/shared/types';

export const config: ToolConfig<
  {
    timezone?: string;
    format?: string;
  },
  {
    result: string;
  }
> = {
  name: 'DateTime Tool',
  description:
    'A tool to get the current date and time. You can specify a timezone (e.g., "America/New_York") and a format (e.g., "YYYY-MM-DD HH:mm:ss"). If no timezone is provided, it defaults to UTC. If no format is provided, it returns the ISO 8601 format.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        nullable: true,
        description:
          'IANA timezone name (e.g., "America/New_York", "Asia/Shanghai"). Defaults to UTC.',
      },
      format: {
        type: 'string',
        nullable: true,
        description:
          'Date format string using Day.js format tokens (e.g., "YYYY-MM-DD HH:mm:ss"). Defaults to ISO 8601.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        description: 'The formatted date and time string.',
      },
    },
    required: ['result'],
  },
};
