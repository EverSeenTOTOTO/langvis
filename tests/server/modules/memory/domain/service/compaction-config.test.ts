import { describe, it, expect } from 'vitest';
import { parse } from '@/server/utils/schemaValidator';
import {
  readCompactionConfig,
  MEMORY_FRAGMENT,
} from '@/server/modules/memory/domain/service/compaction-config';

describe('readCompactionConfig', () => {
  it('读取 memory.compaction（parse 已回填默认值后的运行时配置）', () => {
    const cc = readCompactionConfig({
      memory: {
        compaction: {
          enabled: false,
          threshold: 0.5,
          windowSize: 20,
          keepRecent: 2,
        },
      },
    });
    expect(cc).toEqual({
      enabled: false,
      threshold: 0.5,
      windowSize: 20,
      keepRecent: 2,
    });
  });

  it('enabled:false 被尊重', () => {
    expect(
      readCompactionConfig({
        memory: {
          compaction: {
            enabled: false,
            threshold: 0.8,
            windowSize: 10,
            keepRecent: 4,
          },
        },
      }).enabled,
    ).toBe(false);
  });
});

describe('MEMORY_FRAGMENT schema 默认值', () => {
  it('空配置经 parse 后由 schema default 完整回填嵌套（对象级 default 让 ajv 建出 memory.compaction）', () => {
    const parsed = parse(MEMORY_FRAGMENT.schema, {});
    expect(parsed).toEqual({
      compaction: {
        enabled: true,
        threshold: 0.8,
        windowSize: 10,
        keepRecent: 4,
      },
    });
  });
});
