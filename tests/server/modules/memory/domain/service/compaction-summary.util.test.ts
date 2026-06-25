import { describe, it, expect } from 'vitest';
import {
  findLatestCompactionSummary,
  isCompactionSummary,
  COMPACTION_SUMMARY_KIND,
} from '@/server/modules/memory/domain/service/compaction-summary.util';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

function msg(id: string, meta?: Record<string, unknown>): Message {
  return {
    id,
    role: Role.USER,
    content: id,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'c1',
  };
}

function compaction(id: string): Message {
  return msg(id, { hidden: true, kind: COMPACTION_SUMMARY_KIND });
}

describe('compaction-summary util', () => {
  describe('findLatestCompactionSummary', () => {
    it('无 C 时返回 null / -1', () => {
      const r = findLatestCompactionSummary([msg('m1'), msg('m2')]);
      expect(r.summary).toBeNull();
      expect(r.index).toBe(-1);
    });

    it('单个 C 时返回它及其下标', () => {
      const r = findLatestCompactionSummary([
        msg('m1'),
        compaction('c1'),
        msg('m2'),
      ]);
      expect(r.summary?.id).toBe('c1');
      expect(r.index).toBe(1);
    });

    it('多个 C 时返回最后一个（滚动折叠只认最新）', () => {
      const r = findLatestCompactionSummary([
        compaction('c1'),
        msg('m1'),
        compaction('c2'),
        msg('m2'),
      ]);
      expect(r.summary?.id).toBe('c2');
      expect(r.index).toBe(2);
    });

    it('空列表返回 null', () => {
      expect(findLatestCompactionSummary([]).summary).toBeNull();
    });
  });

  describe('isCompactionSummary', () => {
    it('识别压缩摘要', () => {
      expect(isCompactionSummary(compaction('c1'))).toBe(true);
    });

    it('普通 hidden 消息不算', () => {
      expect(isCompactionSummary(msg('m1', { hidden: true }))).toBe(false);
    });

    it('普通消息不算', () => {
      expect(isCompactionSummary(msg('m1'))).toBe(false);
    });
  });
});
