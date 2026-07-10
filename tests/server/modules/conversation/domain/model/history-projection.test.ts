import { describe, it, expect } from 'vitest';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import { groupIntoTurns } from '@/server/modules/conversation/domain/model/history-projection';

function makeMessage(
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `msg_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'conv_1',
  };
}

describe('history-projection', () => {
  describe('groupIntoTurns', () => {
    it('按 assistant 消息分组 turn', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'question 2'),
        makeMessage(Role.ASSIST, 'answer 2'),
      ];
      const turns = groupIntoTurns(history);
      expect(turns).toHaveLength(2);
      expect(turns[0]).toHaveLength(2);
      expect(turns[1]).toHaveLength(2);
    });

    it('跳过 system 消息', () => {
      const history = [
        makeMessage(Role.SYSTEM, 'You are helpful'),
        makeMessage(Role.USER, 'question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];
      const turns = groupIntoTurns(history);
      expect(turns).toHaveLength(1);
      expect(turns[0][0].role).toBe(Role.USER);
    });

    it('跳过 context user 消息', () => {
      const history = [
        makeMessage(Role.USER, 'hidden context', { kind: 'context' }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];
      const turns = groupIntoTurns(history);
      expect(turns).toHaveLength(1);
      expect(turns[0][0].content).toBe('visible question');
    });

    it('处理不完整 turn（user 无 assistant）', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'pending question'),
      ];
      const turns = groupIntoTurns(history);
      expect(turns).toHaveLength(2);
      expect(turns[1]).toHaveLength(1);
      expect(turns[1][0].role).toBe(Role.USER);
    });

    it('空历史', () => {
      expect(groupIntoTurns([])).toHaveLength(0);
    });
  });
});
