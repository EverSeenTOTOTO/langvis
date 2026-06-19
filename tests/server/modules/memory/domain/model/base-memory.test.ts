import { describe, it, expect } from 'vitest';
import { BaseMemory } from '@/server/modules/memory/domain/model/base-memory';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

/** Concrete subclass for testing BaseMemory's shared methods */
class TestMemory extends BaseMemory {
  async buildContext() {
    return this.history.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
  }
}

function makeMessage(
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `msg_${content}`,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'conv_1',
  };
}

describe('BaseMemory', () => {
  describe('constructor', () => {
    it('should store all params', () => {
      const history = [makeMessage(Role.USER, 'hello')];
      const memory = new TestMemory({
        history,
        systemPrompt: 'You are helpful',
        contextSize: 8000,
        modelId: 'openai:gpt-4',
      });

      expect(memory.getContextUsage().total).toBe(8000);
    });

    it('should work without systemPrompt', () => {
      const memory = new TestMemory({
        history: [],
        contextSize: 4000,
        modelId: '',
      });

      expect(memory.getContextUsage().total).toBe(4000);
    });
  });

  describe('getContextUsage', () => {
    it('should compute usage based on history + contextSize + modelId', () => {
      const history = [
        makeMessage(Role.USER, 'Hello world'),
        makeMessage(Role.ASSIST, 'Hi there'),
      ];

      const memory = new TestMemory({
        history,
        contextSize: 8192,
        modelId: 'openai:gpt-4',
      });

      const usage = memory.getContextUsage();
      expect(usage.total).toBe(8192);
      expect(usage.used).toBeGreaterThan(0);
    });
  });

  describe('groupIntoTurns', () => {
    it('should group messages into turns ending at assistant messages', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'question 2'),
        makeMessage(Role.ASSIST, 'answer 2'),
      ];

      const memory = new TestMemory({
        history,
        contextSize: 8000,
        modelId: '',
      });
      const turns = (memory as any).groupIntoTurns(history);

      expect(turns).toHaveLength(2);
      expect(turns[0]).toHaveLength(2);
      expect(turns[1]).toHaveLength(2);
    });

    it('should skip system messages', () => {
      const history = [
        makeMessage(Role.SYSTEM, 'You are helpful'),
        makeMessage(Role.USER, 'question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];

      const memory = new TestMemory({
        history,
        contextSize: 8000,
        modelId: '',
      });
      const turns = (memory as any).groupIntoTurns(history);

      expect(turns).toHaveLength(1);
      expect(turns[0][0].role).toBe(Role.USER);
    });

    it('should skip hidden user messages', () => {
      const history = [
        makeMessage(Role.USER, 'hidden context', { hidden: true }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];

      const memory = new TestMemory({
        history,
        contextSize: 8000,
        modelId: '',
      });
      const turns = (memory as any).groupIntoTurns(history);

      expect(turns).toHaveLength(1);
      expect(turns[0][0].content).toBe('visible question');
    });

    it('should handle incomplete turn (user without assistant)', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'pending question'),
      ];

      const memory = new TestMemory({
        history,
        contextSize: 8000,
        modelId: '',
      });
      const turns = (memory as any).groupIntoTurns(history);

      expect(turns).toHaveLength(2);
      expect(turns[1]).toHaveLength(1);
      expect(turns[1][0].role).toBe(Role.USER);
    });

    it('should handle empty history', () => {
      const memory = new TestMemory({
        history: [],
        contextSize: 8000,
        modelId: '',
      });
      const turns = (memory as any).groupIntoTurns([]);

      expect(turns).toHaveLength(0);
    });
  });
});
