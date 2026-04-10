import ChatHistoryMemory from '@/server/core/memory/ChatHistory';
import { Role } from '@/shared/types/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/decorator/core', () => ({
  memory: () => () => {},
}));

describe('ChatHistoryMemory', () => {
  let memory: ChatHistoryMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new ChatHistoryMemory();
  });

  describe('summarize', () => {
    it('should return all context messages', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are helpful.',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'Hello',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
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

    it('should strip trailing assistant message', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'System',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'Hello',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-3',
          role: Role.ASSIST,
          content: '',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[1].role).toBe(Role.USER);
    });
  });
});
