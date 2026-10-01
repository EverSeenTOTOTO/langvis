import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { HISTORY_FRAGMENT } from '@/server/libs/config/fragments/history';

describe('HISTORY_FRAGMENT schema 默认值', () => {
  it('空对象经 parse 后由 schema default 回填字段', () => {
    const out = parse(HISTORY_FRAGMENT.schema, {}) as Record<string, unknown>;
    // 只验默认值被回填为数值;这些是经常调参的阈值,不锁死具体大小。
    expect(typeof out.threshold).toBe('number');
    expect(typeof out.windowSize).toBe('number');
  });
});
