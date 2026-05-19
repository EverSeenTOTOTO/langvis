import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import dayjs from 'dayjs';
import tz from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

dayjs.extend(utc);
dayjs.extend(tz);

export type DateTimeGetInput = {
  timezone?: string;
  format?: string;
};

export type DateTimeGetOutput = {
  result: string;
};

@tool(ToolIds.DATETIME_GET)
export default class DateTimeGetTool extends Tool<
  DateTimeGetInput,
  DateTimeGetOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: DateTimeGetInput,
    _ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, DateTimeGetOutput, void> {
    const timezone = data?.timezone;
    const format = data?.format;

    let date = dayjs();

    if (timezone) {
      date = date.tz(timezone);
    }

    const result = format ? date.format(format) : date.format();
    return { result };
  }
}
