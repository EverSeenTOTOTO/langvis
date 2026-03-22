import ChatHistoryMemory from '@/server/core/memory/ChatHistory';
import { TraceContext } from '@/server/core/TraceContext';
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
  });

  describe('store', () => {
    it('should store messages via conversationService', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const messages = [
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
              content: 'Hi there!',
              attachments: null,
              meta: { hidden: true },
              createdAt: new Date(),
              conversationId: 'conv-123',
            },
          ];

          await memory.store(messages);

          expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
            'conv-123',
            messages,
          );
        },
      );
    });

    it('should store single message', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const messages = [
            {
              id: 'msg-1',
              role: Role.SYSTEM,
              content: 'You are a helpful assistant.',
              attachments: null,
              meta: null,
              createdAt: new Date(),
              conversationId: 'conv-123',
            },
          ];

          await memory.store(messages);

          expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
            'conv-123',
            messages,
          );
        },
      );
    });

    it('should store messages with attachments', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const messages = [
            {
              id: 'msg-1',
              role: Role.USER,
              content: 'Analyze this image',
              attachments: [
                {
                  filename: 'photo.jpg',
                  url: 'https://example.com/photo.jpg',
                  mimeType: 'image/jpeg',
                  size: 2048,
                },
              ],
              meta: null,
              createdAt: new Date(),
              conversationId: 'conv-123',
            },
          ];

          await memory.store(messages);

          expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
            'conv-123',
            messages,
          );
        },
      );
    });
  });

  describe('retrieve', () => {
    it('should retrieve messages from conversationService', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.USER,
              content: 'Hello',
              attachments: null,
              meta: null,
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
        },
      );
    });

    it('should return empty array when no messages', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          mockConversationService.getMessagesByConversationId.mockResolvedValue(
            [],
          );

          const result = await memory.retrieve();

          expect(result).toEqual([]);
        },
      );
    });
  });

  describe('clearByConversationId', () => {
    it('should delete messages via conversationService', async () => {
      await memory.clearByConversationId('conv-123');

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
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.USER,
              content: 'Hello',
              attachments: null,
              meta: null,
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
        },
      );
    });
  });
});
