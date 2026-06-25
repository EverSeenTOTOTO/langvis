import { describe, it, expect } from 'vitest';
import { measureUsage } from '@/server/modules/memory/domain/service/measure-usage';
import type { LlmMessage } from '@/shared/types/entities';

describe('measureUsage', () => {
  it('透传 total，used 来自 estimateTokens', () => {
    const msgs: LlmMessage[] = [{ role: 'user', content: 'Hello world' }];
    const u = measureUsage(msgs, 'openai:gpt-4', 8192);
    expect(u.total).toBe(8192);
    expect(u.used).toBeGreaterThan(0);
  });

  it('更长内容消耗更多 token', () => {
    const short: LlmMessage[] = [{ role: 'user', content: 'Hi' }];
    const long: LlmMessage[] = [
      {
        role: 'user',
        content:
          'This is a much longer message that should definitely result in more tokens than the short one.',
      },
    ];
    expect(measureUsage(long, 'openai:gpt-4', 8192).used).toBeGreaterThan(
      measureUsage(short, 'openai:gpt-4', 8192).used,
    );
  });

  it('空消息仍有基线开销', () => {
    expect(measureUsage([], 'openai:gpt-4', 8192).used).toBeLessThan(10);
  });
});
