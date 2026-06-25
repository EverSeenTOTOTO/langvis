import { describe, it, expect } from 'vitest';
import {
  readCompactionConfig,
  COMPACTION_DEFAULTS,
} from '@/server/modules/memory/domain/service/compaction-config';

describe('readCompactionConfig', () => {
  it('undefined runtimeConfig → 全默认', () => {
    expect(readCompactionConfig(undefined)).toEqual(COMPACTION_DEFAULTS);
  });

  it('无 memory.compaction → 全默认', () => {
    expect(readCompactionConfig({ model: { modelId: 'x' } })).toEqual(
      COMPACTION_DEFAULTS,
    );
  });

  it('部分覆盖与默认合并', () => {
    const cc = readCompactionConfig({
      memory: { compaction: { threshold: 0.5, windowSize: 20 } },
    });
    expect(cc.threshold).toBe(0.5);
    expect(cc.windowSize).toBe(20);
    expect(cc.enabled).toBe(true); // 默认
    expect(cc.keepRecent).toBe(4); // 默认
  });

  it('enabled:false 被尊重', () => {
    expect(
      readCompactionConfig({ memory: { compaction: { enabled: false } } })
        .enabled,
    ).toBe(false);
  });
});
