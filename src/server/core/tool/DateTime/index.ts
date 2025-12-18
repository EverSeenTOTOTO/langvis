import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { injectable } from 'tsyringe';
import { Tool } from '..';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

@injectable()
export default class DateTimeTool implements Tool {
  name!: string;
  description!: string;

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

  async streamCall(): Promise<never> {
    throw new Error('Method not implemented.');
  }
}
