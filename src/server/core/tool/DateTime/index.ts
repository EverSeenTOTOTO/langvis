import { tool } from '@/server/decorator/agenttool';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import dayjs from 'dayjs';
import tz from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Tool } from '..';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(tz);

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

export type DateTimeOutput = {
  result: string;
};

@tool(ToolIds.DATE_TIME)
export default class DateTimeTool extends Tool {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async call(@input() data: DateTimeInput): Promise<DateTimeOutput> {
    const timezone = data?.timezone;
    const format = data?.format;

    let date = dayjs();

    // Apply timezone if provided
    if (timezone) {
      date = date.tz(timezone);
    }

    let result = '';
    // Format the date if format is provided
    if (format) {
      result = date.format(format);
    } else {
      // Return formatted date (includes timezone info if timezone was applied)
      result = date.format();
    }

    return { result };
  }
}
