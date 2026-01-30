import ChatHistoryMemory from '@/server/core/memory/ChatHistory';
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

describe('ChatHistoryMemory', () => {
  let memory: ChatHistoryMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new ChatHistoryMemory(
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
        {
          role: Role.ASSIST,
          content: 'Hi there!',
          meta: { key: 'value' },
          createdAt: new Date(),
        },
      ];

      await memory.store(messages);

      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        'conv-123',
        messages,
      );
    });

    it('should store single message', async () => {
      const messages = [
        {
          role: Role.SYSTEM,
          content: 'You are a helpful assistant.',
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

    it('should return empty array when no messages', async () => {
      mockConversationService.getMessagesByConversationId.mockResolvedValue([]);

      const result = await memory.retrieve();

      expect(result).toEqual([]);
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
        'ChatHistoryMemory does not support clearByUserId',
      );
    });
  });

  describe('summarize', () => {
    it('should call retrieve (same as summarize)', async () => {
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

      const result = await memory.summarize();

      expect(
        mockConversationService.getMessagesByConversationId,
      ).toHaveBeenCalledWith('conv-123');
      expect(result).toEqual(mockMessages);
    });
  });
});
