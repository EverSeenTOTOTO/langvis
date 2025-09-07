import { describe, it, expect, beforeEach } from 'vitest';
import DateTimeTool from '@/server/core/agent/DateTime';
import type { AgentCallContext } from '@/server/core/agent';

describe('DateTimeTool', () => {
  let dateTimeTool: DateTimeTool;
  let mockContext: AgentCallContext;

  beforeEach(() => {
    dateTimeTool = new DateTimeTool();
    mockContext = {
      conversationId: 'test-conversation-id',
    };
  });

  it('should return current time in ISO-like format by default', async () => {
    const result = await dateTimeTool.call(mockContext, {});
    expect(result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified format', async () => {
    const result = await dateTimeTool.call(mockContext, {
      format: 'YYYY-MM-DD HH:mm:ss',
    });
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('should return time in specified timezone', async () => {
    const result = await dateTimeTool.call(mockContext, {
      timezone: 'America/New_York',
    });
    // Should be in ISO format but with timezone offset
    expect(result).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}/,
    );
  });

  it('should return time in specified timezone and format', async () => {
    const result = await dateTimeTool.call(mockContext, {
      timezone: 'Asia/Tokyo',
      format: 'YYYY年MM月DD日 HH:mm:ss',
    });
    expect(result).toMatch(/\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}:\d{2}/);
  });

  it('should throw error for invalid timezone', async () => {
    await expect(
      dateTimeTool.call(mockContext, {
        timezone: 'Invalid/Timezone',
      }),
    ).rejects.toThrow('Invalid timezone: Invalid/Timezone');
  });

  it('should throw error for streamCall method', async () => {
    await expect(dateTimeTool.streamCall()).rejects.toThrow(
      'Method not implemented.',
    );
  });
});
