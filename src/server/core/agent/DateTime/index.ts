import { injectable } from 'tsyringe';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Agent, AgentCallContext } from '..';
import { AGENT_META } from '@/shared/constants';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

@injectable()
export default class DateTimeTool implements Agent {
  static readonly Type = AGENT_META.DATE_TIME_TOOL.Type;
  static readonly Name = AGENT_META.DATE_TIME_TOOL.Name.en; // Access localized name
  static readonly Description = AGENT_META.DATE_TIME_TOOL.Description.en; // Access localized description

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
