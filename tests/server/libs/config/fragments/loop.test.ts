import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { LOOP_FRAGMENT } from '@/server/libs/config/fragments/loop';

describe('LOOP_FRAGMENT schema 默认值', () => {
  it('空对象经 parse 后由 schema default 回填全部字段', () => {
    const out = parse(LOOP_FRAGMENT.schema, {}) as Record<string, unknown>;
    // 只验默认值被回填为数值;这些是经常调参的阈值/窗口,不锁死具体大小。
    expect(typeof out.threshold).toBe('number');
    expect(typeof out.windowSize).toBe('number');
    expect(typeof out.keepRecent).toBe('number');
  });
});
