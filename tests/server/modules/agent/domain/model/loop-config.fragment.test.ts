import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { LOOP_FRAGMENT } from '@/server/modules/agent/domain/model/loop-config.fragment';

describe('LOOP_FRAGMENT.read', () => {
  it('从 runtimeConfig 读取 loop 配置', () => {
    const cc = LOOP_FRAGMENT.read({
      loop: { threshold: 0.5, windowSize: 20, keepRecent: 2 },
    });
    expect(cc).toEqual({ threshold: 0.5, windowSize: 20, keepRecent: 2 });
  });
});

describe('LOOP_FRAGMENT schema 默认值', () => {
  it('空对象经 parse 后由 schema default 回填全部字段', () => {
    expect(parse(LOOP_FRAGMENT.schema, {})).toEqual({
      threshold: 0.8,
      windowSize: 10,
      keepRecent: 4,
    });
  });
});
