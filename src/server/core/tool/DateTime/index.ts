import { tool } from '@/server/decorator/agenttool';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Tool } from '..';
import type { Logger } from '@/server/utils/logger';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

@tool(ToolIds.DATE_TIME)
export default class DateTimeTool extends Tool {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async call(input: Record<string, any>): Promise<string> {
    const timezone = input?.timezone;
    const format = input?.format;

    let date = dayjs();

    // Apply timezone if provided
    if (timezone) {
      try {
        date = date.tz(timezone);
      } catch {
        throw new Error(`Invalid timezone: ${timezone}`);
      }
    }

    // Format the date if format is provided
    if (format) {
      try {
        return date.format(format);
      } catch {
        throw new Error(`Invalid format: ${format}`);
      }
    }

    // Return formatted date (includes timezone info if timezone was applied)
    return date.format();
  }
}
