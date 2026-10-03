import { tool } from '@/server/modules/agent/application/tools/register-tool';
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

  describe(
    input: Record<string, unknown>,
    output?: unknown,
    _error?: string,
  ): string {
    const { timezone } = input as DateTimeGetInput;
    const result = (output as DateTimeGetOutput | undefined)?.result;
    return `read time${timezone ? ` (${timezone})` : ''}: ${result ?? ''}`;
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<never, DateTimeGetOutput, void> {
    const data = ctx.input as DateTimeGetInput;
    const timezone = data?.timezone;
    const format = data?.format;

    let date = dayjs();

    if (timezone) {
      try {
        date = date.tz(timezone);
      } catch {
        // 错误消息自带默认时区的当前时间——模型无需再发起一轮补救调用
        const localNow = format ? dayjs().format(format) : dayjs().format();
        throw new Error(
          `Invalid IANA timezone '${timezone}'. Current time in the server default timezone (${dayjs.tz.guess()}): ${localNow}`,
        );
      }
    }

    const result = format ? date.format(format) : date.format();
    return { result };
  }
}
