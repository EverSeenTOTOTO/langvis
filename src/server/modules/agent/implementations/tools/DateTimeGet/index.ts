import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import dayjs from 'dayjs';
import tz from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';

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
export default class DateTimeGetTool extends Tool<DateTimeGetOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<never, DateTimeGetOutput, void> {
    const data = ctx.input as DateTimeGetInput;
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
