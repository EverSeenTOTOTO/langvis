import NoneMemory from '@/server/core/memory/None';
import { TraceContext } from '@/server/core/TraceContext';
import { ConversationService } from '@/server/service/ConversationService';
import { WorkspaceService } from '@/server/service/WorkspaceService';
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

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockResolvedValue('/tmp/workspace'),
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
      mockWorkspaceService as unknown as WorkspaceService,
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
              content: 'What is in this image?',
              attachments: [
                {
                  filename: 'test.png',
                  url: 'https://example.com/test.png',
                  mimeType: 'image/png',
                  size: 1024,
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
    it('should return only system and last user message', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.SYSTEM,
              content: 'You are a helpful assistant.',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-2',
              role: Role.USER,
              content: 'First question',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-3',
              role: Role.ASSIST,
              content: 'First answer',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-4',
              role: Role.USER,
              content: 'Second question',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-5',
              role: Role.ASSIST,
              content: '',
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

          expect(result).toHaveLength(2);
          expect(result[0].role).toBe(Role.SYSTEM);
          expect(result[0].content).toBe('You are a helpful assistant.');
          expect(result[1].role).toBe(Role.USER);
          expect(result[1].content).toBe('Second question');
        },
      );
    });

    it('should return only last user message when no system message', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.USER,
              content: 'First question',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-2',
              role: Role.ASSIST,
              content: 'Answer',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-3',
              role: Role.USER,
              content: 'Second question',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-4',
              role: Role.ASSIST,
              content: '',
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

          expect(result).toHaveLength(1);
          expect(result[0].role).toBe(Role.USER);
          expect(result[0].content).toBe('Second question');
        },
      );
    });

    it('should return only system message when second to last message is not user', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.SYSTEM,
              content: 'You are a helpful assistant.',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-2',
              role: Role.USER,
              content: 'Question',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-3',
              role: Role.ASSIST,
              content: 'Answer',
              attachments: null,
              meta: null,
              conversationId: 'conv-123',
              createdAt: new Date(),
            },
            {
              id: 'msg-4',
              role: Role.ASSIST,
              content: '',
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

          expect(result).toHaveLength(1);
          expect(result[0].role).toBe(Role.SYSTEM);
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

          const result = await memory.summarize();

          expect(result).toEqual([]);
        },
      );
    });

    it('should return single user message when user message with streaming assistant', async () => {
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
            {
              id: 'msg-2',
              role: Role.ASSIST,
              content: '',
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

          expect(result).toHaveLength(1);
          expect(result[0].role).toBe(Role.USER);
        },
      );
    });

    it('should return single system message when only system message exists', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123' },
        async () => {
          const mockMessages = [
            {
              id: 'msg-1',
              role: Role.SYSTEM,
              content: 'You are a helpful assistant.',
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

          expect(result).toHaveLength(1);
          expect(result[0].role).toBe(Role.SYSTEM);
        },
      );
    });
  });
});
