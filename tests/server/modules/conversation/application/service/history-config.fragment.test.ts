import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { HISTORY_FRAGMENT } from '@/server/modules/conversation/application/service/history-config.fragment';

describe('HISTORY_FRAGMENT.read', () => {
  it('从 runtimeConfig 读取 history 配置', () => {
    const cc = HISTORY_FRAGMENT.read({
      history: { threshold: 0.5, windowSize: 20 },
    });
    expect(cc).toEqual({ threshold: 0.5, windowSize: 20 });
  });
});

describe('HISTORY_FRAGMENT schema 默认值', () => {
  it('空对象经 parse 后由 schema default 回填全部字段', () => {
    expect(parse(HISTORY_FRAGMENT.schema, {})).toEqual({
      threshold: 0.8,
      windowSize: 10,
    });
  });
});
