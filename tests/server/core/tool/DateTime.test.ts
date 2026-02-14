import DateTimeTool from '@/server/core/tool/DateTime';
import { ExecutionContext } from '@/server/core/context';
import { runTool } from '@/server/utils';
import { beforeEach, describe, expect, it } from 'vitest';

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
}

describe('DateTimeTool', () => {
  let dateTimeTool: DateTimeTool;

  beforeEach(() => {
    dateTimeTool = new DateTimeTool();
  });

  it('should return current time in ISO-like format by default', async () => {
    const ctx = createMockContext();
    const result = await runTool(dateTimeTool.call({}, ctx));
    expect(result.result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified format', async () => {
    const ctx = createMockContext();
    const result = await runTool(
      dateTimeTool.call(
        {
          format: 'YYYY-MM-DD HH:mm:ss',
        },
        ctx,
      ),
    );
    expect(result.result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('should return time in specified timezone', async () => {
    const ctx = createMockContext();
    const result = await runTool(
      dateTimeTool.call(
        {
          timezone: 'America/New_York',
        },
        ctx,
      ),
    );
    expect(result.result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified timezone and format', async () => {
    const ctx = createMockContext();
    const result = await runTool(
      dateTimeTool.call(
        {
          timezone: 'Asia/Tokyo',
          format: 'YYYY年MM月DD日 HH:mm:ss',
        },
        ctx,
      ),
    );
    expect(result.result).toMatch(/\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}:\d{2}/);
  });

  it('should throw error for invalid timezone', async () => {
    const ctx = createMockContext();
    await expect(
      runTool(
        dateTimeTool.call(
          {
            timezone: 'Invalid/Timezone',
          },
          ctx,
        ),
      ),
    ).rejects.toThrow('Invalid time zone specified: Invalid/Timezone');
  });
});
