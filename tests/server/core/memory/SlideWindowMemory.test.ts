import SlideWindowMemory from '@/server/core/memory/SlideWindow';
import { Role } from '@/shared/types/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/decorator/core', () => ({
  memory: () => () => {},
}));

function createMessage(
  id: string,
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
) {
  return {
    id,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'conv-123',
  };
}

describe('SlideWindowMemory', () => {
  let memory: SlideWindowMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new SlideWindowMemory();
  });

  describe('setWindowSize', () => {
    it('should allow setting window size', () => {
      memory.setWindowSize(5);
      expect((memory as any).windowSize).toBe(5);
    });
  });

  describe('summarize', () => {
    it('should return all messages when under window size', async () => {
      memory.setWindowSize(10);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Question 1'),
        createMessage('msg-3', Role.ASSIST, 'Answer 1'),
        createMessage('msg-4', Role.USER, 'Question 2'),
        createMessage('msg-5', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // No truncation notice when all messages fit
      expect(result).toHaveLength(5);
      expect(result.every(m => !m.content?.includes('truncated'))).toBe(true);
    });

    it('should show truncation notice with correct turn count', async () => {
      memory.setWindowSize(1);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Q1'),
        createMessage('msg-3', Role.ASSIST, 'A1'),
        createMessage('msg-4', Role.USER, 'Q2'),
        createMessage('msg-5', Role.ASSIST, 'A2'),
        createMessage('msg-6', Role.USER, 'Q3'),
        createMessage('msg-7', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // 3 turns total, keep 1, truncated 2
      const truncationNotice = result.find(
        m =>
          m.role === Role.USER &&
          m.meta?.hidden &&
          m.content?.includes('truncated'),
      );
      expect(truncationNotice).toBeDefined();
      expect(truncationNotice?.content).toContain('2 turns');
    });

    it('should keep only last N turns when over window size', async () => {
      memory.setWindowSize(2);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Question 1'),
        createMessage('msg-3', Role.ASSIST, 'Answer 1'),
        createMessage('msg-4', Role.USER, 'Question 2'),
        createMessage('msg-5', Role.ASSIST, 'Answer 2'),
        createMessage('msg-6', Role.USER, 'Question 3'),
        createMessage('msg-7', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // system + truncation notice + turn2 + turn3 = 6 messages
      expect(result).toHaveLength(6);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[1].role).toBe(Role.USER);
      expect(result[1].meta?.hidden).toBe(true);
      expect(result[1].content).toContain('1 turn');
      expect(result[2].content).toBe('Question 2');
      expect(result[3].content).toBe('Answer 2');
      expect(result[4].content).toBe('Question 3');
      expect(result[5].role).toBe(Role.ASSIST);
    });

    it('should always include system message', async () => {
      memory.setWindowSize(1);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Question 1'),
        createMessage('msg-3', Role.ASSIST, 'Answer 1'),
        createMessage('msg-4', Role.USER, 'Question 2'),
        createMessage('msg-5', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      expect(result[0].role).toBe(Role.SYSTEM);
    });

    it('should always include hidden user messages', async () => {
      memory.setWindowSize(1);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Session context', { hidden: true }),
        createMessage('msg-3', Role.USER, 'Workflow instructions', {
          hidden: true,
        }),
        createMessage('msg-4', Role.USER, 'Question'),
        createMessage('msg-5', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // system + hidden messages + last turn (user + assist)
      expect(result).toHaveLength(5);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[1].content).toBe('Session context');
      expect(result[2].content).toBe('Workflow instructions');
      expect(result[3].content).toBe('Question');
      expect(result[4].role).toBe(Role.ASSIST);
    });

    it('should handle incomplete turn (user without assistant)', async () => {
      memory.setWindowSize(5);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Question'),
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[1].role).toBe(Role.USER);
    });

    it('should return empty array when no context', async () => {
      memory.setContext([]);

      const result = await memory.summarize();

      expect(result).toEqual([]);
    });

    it('should handle only system message', async () => {
      memory.setContext([createMessage('msg-1', Role.SYSTEM, 'System prompt')]);

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.SYSTEM);
    });

    it('should handle window size 1 (single turn)', async () => {
      memory.setWindowSize(1);
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System prompt'),
        createMessage('msg-2', Role.USER, 'Question 1'),
        createMessage('msg-3', Role.ASSIST, 'Answer 1'),
        createMessage('msg-4', Role.USER, 'Question 2'),
        createMessage('msg-5', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // system + truncation notice + last turn = 4 messages
      expect(result).toHaveLength(4);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[1].role).toBe(Role.USER);
      expect(result[1].meta?.hidden).toBe(true);
      expect(result[1].content).toContain('1 turn');
      expect(result[2].role).toBe(Role.USER);
      expect(result[2].content).toBe('Question 2');
      expect(result[3].role).toBe(Role.ASSIST);
    });

    it('should handle user message without preceding assistant (consecutive user messages)', async () => {
      memory.setWindowSize(5);
      memory.setContext([
        createMessage('msg-1', Role.USER, 'First question'),
        createMessage('msg-2', Role.USER, 'Follow up question'),
        createMessage('msg-3', Role.ASSIST, ''),
      ]);

      const result = await memory.summarize();

      // Should treat consecutive user messages as part of same turn
      expect(result).toHaveLength(3);
    });

    it('should use default window size when not set', async () => {
      // Default is MAX_SAFE_INTEGER, so all messages should be kept
      memory.setContext([
        createMessage('msg-1', Role.SYSTEM, 'System'),
        ...Array.from({ length: 100 }, (_, i) => [
          createMessage(`user-${i}`, Role.USER, `Question ${i}`),
          createMessage(`assist-${i}`, Role.ASSIST, `Answer ${i}`),
        ]).flat(),
      ]);

      const result = await memory.summarize();

      // system + 100 turns (each 2 messages) = 201
      expect(result).toHaveLength(201);
    });
  });
});
