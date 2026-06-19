import { describe, it, expect } from 'vitest';
import { SlidingWindowMemory } from '@/server/modules/memory/application/service/sliding-window.memory';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

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

function createMemory(
  history: Message[],
  opts: {
    systemPrompt?: string;
    windowSize?: number;
    contextSize?: number;
  } = {},
) {
  return new SlidingWindowMemory({
    history,
    systemPrompt: opts.systemPrompt,
    contextSize: opts.contextSize ?? 8000,
    modelId: 'openai:gpt-4',
    windowSize: opts.windowSize ?? 10,
  });
}

describe('SlidingWindowMemory', () => {
  describe('buildContext', () => {
    it('should include system prompt first', async () => {
      const memory = createMemory([], { systemPrompt: 'You are helpful' });
      const messages = await memory.buildContext();

      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are helpful',
      });
    });

    it('should work without system prompt', async () => {
      const history = [makeMessage(Role.USER, 'hello')];
      const memory = createMemory(history);
      const messages = await memory.buildContext();

      expect(messages[0].role).toBe('user');
    });

    it('should include hidden user messages after system prompt', async () => {
      const history = [
        makeMessage(Role.USER, 'session context', { hidden: true }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];

      const memory = createMemory(history, { systemPrompt: 'system' });
      const messages = await memory.buildContext();

      // system → hidden user (injected early) → truncated notice? → visible turn
      const hiddenMsg = messages.find(m => m.content === 'session context');
      expect(hiddenMsg).toBeDefined();
      expect(hiddenMsg!.role).toBe('user');
    });

    it('should truncate old turns when exceeding windowSize', async () => {
      const history: Message[] = [];
      // Create 15 turns (user + assistant each)
      for (let i = 0; i < 15; i++) {
        history.push(makeMessage(Role.USER, `question ${i}`));
        history.push(makeMessage(Role.ASSIST, `answer ${i}`));
      }

      const memory = createMemory(history, { windowSize: 5 });
      const messages = await memory.buildContext();

      // Should have truncated notice + 5 recent turns
      const truncatedMsg = messages.find(
        m => m.content.includes('10 turns') && m.content.includes('truncated'),
      );
      expect(truncatedMsg).toBeDefined();
      expect(truncatedMsg!.role).toBe('user');

      // Recent turns should include turns 10-14
      const recentUser = messages.find(m => m.content === 'question 14');
      expect(recentUser).toBeDefined();
    });

    it('should not truncate when turns fit within window', async () => {
      const history = [
        makeMessage(Role.USER, 'q1'),
        makeMessage(Role.ASSIST, 'a1'),
        makeMessage(Role.USER, 'q2'),
        makeMessage(Role.ASSIST, 'a2'),
      ];

      const memory = createMemory(history, { windowSize: 10 });
      const messages = await memory.buildContext();

      const truncatedMsg = messages.find(m => m.content.includes('truncated'));
      expect(truncatedMsg).toBeUndefined();
    });

    it('should return all messages from recent turns in order', async () => {
      const history = [
        makeMessage(Role.USER, 'q1'),
        makeMessage(Role.ASSIST, 'a1'),
        makeMessage(Role.USER, 'q2'),
        makeMessage(Role.ASSIST, 'a2'),
      ];

      const memory = createMemory(history, { systemPrompt: 'sys' });
      const messages = await memory.buildContext();

      // system, q1, a1, q2, a2
      expect(messages).toHaveLength(5);
      expect(messages[0].role).toBe('system');
      expect(messages[1].content).toBe('q1');
      expect(messages[2].content).toBe('a1');
      expect(messages[3].content).toBe('q2');
      expect(messages[4].content).toBe('a2');
    });

    it('should handle empty history', async () => {
      const memory = createMemory([], { systemPrompt: 'sys' });
      const messages = await memory.buildContext();

      expect(messages).toEqual([{ role: 'system', content: 'sys' }]);
    });
  });
});
