import DateTimeTool from '@/server/core/tool/DateTime';
import { runTool } from '@/server/utils';
import { beforeEach, describe, expect, it } from 'vitest';

describe('DateTimeTool', () => {
  let dateTimeTool: DateTimeTool;

  beforeEach(() => {
    dateTimeTool = new DateTimeTool();
  });

  it('should return current time in ISO-like format by default', async () => {
    const result = await runTool(dateTimeTool.call({}));
    expect(result.result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified format', async () => {
    const result = await runTool(
      dateTimeTool.call({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
    );
    expect(result.result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('should return time in specified timezone', async () => {
    const result = await runTool(
      dateTimeTool.call({
        timezone: 'America/New_York',
      }),
    );
    expect(result.result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified timezone and format', async () => {
    const result = await runTool(
      dateTimeTool.call({
        timezone: 'Asia/Tokyo',
        format: 'YYYY年MM月DD日 HH:mm:ss',
      }),
    );
    expect(result.result).toMatch(/\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}:\d{2}/);
  });

  it('should throw error for invalid timezone', async () => {
    await expect(
      runTool(
        dateTimeTool.call({
          timezone: 'Invalid/Timezone',
        }),
      ),
    ).rejects.toThrow('Invalid time zone specified: Invalid/Timezone');
  });
});
