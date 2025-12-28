import { ToolConfig } from '@/shared/types';

export const config: ToolConfig = {
  name: {
    en: 'DateTime Tool',
    zh: '日期时间工具',
  },
  description: {
    en: 'A tool to get the current date and time. You can specify a `timezone` (e.g., "America/New_York") and a `format` (e.g., "YYYY-MM-DD HH:mm:ss"). If no timezone is provided, it defaults to UTC. If no format is provided, it returns the ISO 8601 format.',
    zh: '获取当前日期和时间的工具。可以指定 `timezone`（如 "America/New_York"）和 `format`（如 "YYYY-MM-DD HH:mm:ss"）。如果未提供时区，默认使用 UTC。如果未提供格式，则返回 ISO 8601 格式。',
  },
  input: {
    description: {
      en: 'Optional parameters to customize date/time output',
      zh: '可选参数用于自定义日期/时间输出',
    },
    parameters: {
      timezone: {
        type: 'string',
        required: false,
        description: {
          en: 'IANA timezone name (e.g., "America/New_York", "Asia/Shanghai"). If not provided, defaults to UTC.',
          zh: 'IANA 时区名称（例如 "America/New_York"、"Asia/Shanghai"）。如果未提供，默认使用 UTC。',
        },
      },
      format: {
        type: 'string',
        required: false,
        description: {
          en: 'Date format string using Day.js format tokens (e.g., "YYYY-MM-DD HH:mm:ss", "MMM DD, YYYY"). If not provided, returns ISO 8601 format.',
          zh: '使用 Day.js 格式标记的日期格式字符串（例如 "YYYY-MM-DD HH:mm:ss"、"MMM DD, YYYY"）。如果未提供，返回 ISO 8601 格式。',
        },
      },
    },
  },
  output: {
    description: {
      en: 'Formatted date and time string',
      zh: '格式化的日期和时间字符串',
    },
    parameters: {
      result: {
        type: 'string',
        description: {
          en: 'The formatted date and time string based on the specified format and timezone',
          zh: '根据指定格式和时区生成的格式化日期和时间字符串',
        },
      },
    },
  },
};
