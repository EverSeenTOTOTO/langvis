import NoneMemory from '@/server/core/memory/None';
import { Role } from '@/shared/types/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/decorator/core', () => ({
  memory: () => () => {},
}));

describe('NoneMemory', () => {
  let memory: NoneMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new NoneMemory();
  });

  describe('summarize', () => {
    it('should return only system and last user message', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'First question',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-3',
          role: Role.ASSIST,
          content: 'First answer',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-4',
          role: Role.USER,
          content: 'Second question',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-5',
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
      expect(result[0].content).toBe('You are a helpful assistant.');
      expect(result[1].role).toBe(Role.USER);
      expect(result[1].content).toBe('Second question');
    });

    it('should return only last user message when no system message', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'First question',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.ASSIST,
          content: 'Answer',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-3',
          role: Role.USER,
          content: 'Second question',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-4',
          role: Role.ASSIST,
          content: '',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.USER);
      expect(result[0].content).toBe('Second question');
    });

    it('should return only system message when second to last message is not user', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'Question',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-3',
          role: Role.ASSIST,
          content: 'Answer',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-4',
          role: Role.ASSIST,
          content: '',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.SYSTEM);
    });

    it('should return empty array when no context', async () => {
      memory.setContext([]);

      const result = await memory.summarize();

      expect(result).toEqual([]);
    });

    it('should return single user message when user message with streaming assistant', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {
          id: 'msg-2',
          role: Role.ASSIST,
          content: '',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.USER);
    });

    it('should return single system message when only system message exists', async () => {
      memory.setContext([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          attachments: null,
          meta: null,
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.SYSTEM);
    });
  });
});
