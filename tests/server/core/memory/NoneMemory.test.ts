import NoneMemory from '@/server/core/memory/None';
import { ConversationService } from '@/server/service/ConversationService';
import { Role } from '@/shared/types/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/decorator/core', () => ({
  memory: () => () => {},
}));

const mockConversationService = {
  batchAddMessages: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  batchDeleteMessagesInConversation: vi.fn(),
};

vi.mock('tsyringe', async importOriginal => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    inject: () => () => {},
    injectable: () => () => {},
  };
});

describe('NoneMemory', () => {
  let memory: NoneMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new NoneMemory(
      mockConversationService as unknown as ConversationService,
    );
    memory.setConversationId('conv-123');
  });

  describe('store', () => {
    it('should store messages via conversationService', async () => {
      const messages = [
        {
          role: Role.USER,
          content: 'Hello',
          meta: null,
          createdAt: new Date(),
        },
      ];

      await memory.store(messages);

      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        'conv-123',
        messages,
      );
    });
  });

  describe('retrieve', () => {
    it('should retrieve messages from conversationService', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.retrieve();

      expect(
        mockConversationService.getMessagesByConversationId,
      ).toHaveBeenCalledWith('conv-123');
      expect(result).toEqual(mockMessages);
    });
  });

  describe('clearByConversationId', () => {
    it('should delete messages via conversationService', async () => {
      await memory.clearByConversationId();

      expect(
        mockConversationService.batchDeleteMessagesInConversation,
      ).toHaveBeenCalledWith('conv-123');
    });
  });

  describe('clearByUserId', () => {
    it('should throw error as not supported', async () => {
      await expect(memory.clearByUserId('user-123')).rejects.toThrow(
        'NoneMemory does not support clearByUserId',
      );
    });
  });

  describe('summarize', () => {
    it('should return only system and last user message', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'First question',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-3',
          role: Role.ASSIST,
          content: 'First answer',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-4',
          role: Role.USER,
          content: 'Second question',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-5',
          role: Role.ASSIST,
          content: '',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.summarize();

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe(Role.SYSTEM);
      expect(result[0].content).toBe('You are a helpful assistant.');
      expect(result[1].role).toBe(Role.USER);
      expect(result[1].content).toBe('Second question');
    });

    it('should return only last user message when no system message', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'First question',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-2',
          role: Role.ASSIST,
          content: 'Answer',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-3',
          role: Role.USER,
          content: 'Second question',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-4',
          role: Role.ASSIST,
          content: '',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.USER);
      expect(result[0].content).toBe('Second question');
    });

    it('should return only system message when second to last message is not user', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-2',
          role: Role.USER,
          content: 'Question',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-3',
          role: Role.ASSIST,
          content: 'Answer',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-4',
          role: Role.ASSIST,
          content: '',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.SYSTEM);
    });

    it('should return empty array when no messages', async () => {
      mockConversationService.getMessagesByConversationId.mockResolvedValue([]);

      const result = await memory.summarize();

      expect(result).toEqual([]);
    });

    it('should return single user message when user message with streaming assistant', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'msg-2',
          role: Role.ASSIST,
          content: '',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.USER);
    });

    it('should return single system message when only system message exists', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ];
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockMessages,
      );

      const result = await memory.summarize();

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(Role.SYSTEM);
    });
  });
});
