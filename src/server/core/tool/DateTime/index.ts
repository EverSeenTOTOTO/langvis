/* eslint-disable require-yield */
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

export type DateTimeInput = {
  timezone?: string;
  format?: string;
};

export type DateTimeOutput = {
  result: string;
};

@tool(ToolIds.DATE_TIME)
export default class DateTimeTool extends Tool<DateTimeInput, DateTimeOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: DateTimeInput,
    _ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, DateTimeOutput, void> {
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
