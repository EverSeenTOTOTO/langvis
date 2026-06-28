import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import { MEMORY_FRAGMENT } from '@/server/modules/memory/domain/service/compaction-config';

describe('MEMORY_FRAGMENT.read', () => {
  it('从 runtimeConfig 读取 memory.compaction', () => {
    const cc = MEMORY_FRAGMENT.read({
      memory: {
        compaction: {
          threshold: 0.5,
          windowSize: 20,
          keepRecent: 2,
        },
      },
    });
    expect(cc).toEqual({
      threshold: 0.5,
      windowSize: 20,
      keepRecent: 2,
    });
  });
});

describe('MEMORY_FRAGMENT schema 默认值', () => {
  it('空配置经 parse 后由 schema default 完整回填嵌套（对象级 default 让 ajv 建出 memory.compaction）', () => {
    const parsed = parse(MEMORY_FRAGMENT.schema, {});
    expect(parsed).toEqual({
      compaction: {
        threshold: 0.8,
        windowSize: 10,
        keepRecent: 4,
      },
    });
  });
});
