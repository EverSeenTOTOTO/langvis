import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { LOOP_FRAGMENT } from '@/server/libs/config/fragments/loop';

describe('LOOP_FRAGMENT schema 默认值', () => {
  it('空对象经 parse 后由 schema default 回填全部字段', () => {
    expect(parse(LOOP_FRAGMENT.schema, {})).toEqual({
      threshold: 0.8,
      windowSize: 10,
      keepRecent: 4,
    });
  });
});
