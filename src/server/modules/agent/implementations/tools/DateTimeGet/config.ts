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
    'Get the current date and time, optionally in a given timezone and format.',
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
