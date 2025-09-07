import { injectable } from 'tsyringe';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Agent, AgentCallContext } from '..';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

@injectable()
export default class DateTimeTool implements Agent {
  static readonly Name = 'DateTime Tool';
  static readonly Description =
    'A tool to get the current date and time. You can specify a `timezone` (e.g., "America/New_York") and a `format` (e.g., "YYYY-MM-DD HH:mm:ss"). If no timezone is provided, it defaults to UTC. If no format is provided, it returns the ISO 8601 format.';

  async call(_ctx: AgentCallContext, input: DateTimeInput): Promise<string> {
    const { timezone, format } = input;

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
