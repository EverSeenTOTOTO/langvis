import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { PendingMessage } from '@/server/core/PendingMessage';
import { TraceContext } from '@/server/core/TraceContext';
import { Role } from '@/shared/entities/Message';
import { InjectTokens, MemoryIds, RedisKeys } from '@/shared/constants';
import { RedisService } from '@/server/service/RedisService';
import { ConversationService } from '@/server/service/ConversationService';
import type { DataSource } from 'typeorm';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockRedisService: any;
  let mockConversationService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockRedisService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
      acquireLock: vi.fn().mockResolvedValue(true),
      releaseLock: vi.fn().mockResolvedValue(undefined),
    };

    mockConversationService = {
      findNonTerminalAssistantMessages: vi.fn().mockResolvedValue([]),
    };

    // Register mock DataSource
    const mockDataSource = {
      getRepository: vi.fn(),
      query: vi.fn(),
    } as unknown as DataSource;

    container.register(InjectTokens.PG, { useValue: mockDataSource });
    container.register(RedisService, { useValue: mockRedisService });
    container.register(ConversationService, {
      useValue: mockConversationService,
    });

    chatService = container.resolve(ChatService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('acquireSession', () => {
    it('should create new session for conversation', async () => {
      const session = await chatService.acquireSession('conv-123');

      expect(session).toBeDefined();
      expect(session?.conversationId).toBe('conv-123');
      expect(session?.phase).toBe('waiting');
    });

    it('should return existing session for reconnection', async () => {
      const session1 = await chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      // Bind mock connection
      const mockConn = {
        conversationId: 'conv-123',
        get isWritable() {
          return true;
        },
        send: vi.fn().mockReturnValue(true),
        close: vi.fn(),
      };
      session1!.bindConnection(mockConn as any);

      const session2 = await chatService.acquireSession('conv-123');
      expect(session2).toBe(session1); // Reconnection returns same session
    });

    it('should return existing waiting session for reconnection', async () => {
      const session1 = await chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      const session2 = await chatService.acquireSession('conv-123');
      expect(session2).toBeDefined();
      expect(session2).toBe(session1); // Same session for reconnection
    });

    it('should clean Redis key on dispose', async () => {
      const session = await chatService.acquireSession('conv-123');
      await session!.cleanup();

      expect(mockRedisService.del).toHaveBeenCalledWith(
        RedisKeys.CHAT_SESSION('conv-123'),
      );
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      const session = chatService.getSession('non-existent');
      expect(session).toBeUndefined();
    });

    it('should return existing session', async () => {
      await chatService.acquireSession('conv-123');
      const session = chatService.getSession('conv-123');

      expect(session).toBeDefined();
      expect(session?.conversationId).toBe('conv-123');
    });
  });

  describe('runSession', () => {
    it('should run agent and finalize message', async () => {
      const session = await chatService.acquireSession('conv-123');
      const MSG_ID = 'assistant-msg';

      const mockConn = {
        conversationId: 'conv-123',
        response: {
          writable: true,
          write: vi.fn().mockReturnValue(true),
          flush: vi.fn(),
          writableEnded: false,
          end: vi.fn(),
        },
        heartbeat: null,
        close: vi.fn(),
        get isWritable() {
          return true;
        },
        send: vi.fn().mockReturnValue(true),
      };
      session!.bindConnection(mockConn as any);

      const mockAgent = {
        id: 'test-agent',
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', messageId: MSG_ID, seq: 1, at: Date.now() };
          yield {
            type: 'stream',
            messageId: MSG_ID,
            content: 'Hello',
            seq: 2,
            at: Date.now(),
          };
          yield { type: 'final', messageId: MSG_ID, seq: 3, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMessage = {
        id: MSG_ID,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      const updateMessage = vi.fn().mockResolvedValue(undefined);
      const pendingMessage = new PendingMessage(mockMessage, updateMessage);
      session!.addMessageFSM(mockMessage.id, pendingMessage);

      await chatService.runSession(
        session!,
        mockAgent,
        {} as Memory,
        {},
        mockMessage.id,
      );

      expect(mockAgent.call).toHaveBeenCalled();
      expect(updateMessage).toHaveBeenCalled();
      // After message completes, session returns to waiting (not done)
      // done only happens on idle timeout or explicit cleanup
      expect(session!.phase).toBe('waiting');
    });
  });

  describe('buildMemory', () => {
    it('should build memory and return it', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123', userId: 'user-123' },
        async () => {
          const mockMemory = {
            initialize: vi.fn().mockResolvedValue(undefined),
          };

          const mockAgent = {
            systemPrompt: {
              build: vi.fn().mockReturnValue('System prompt'),
            },
          };

          container.register('test-memory', { useValue: mockMemory });

          const config = {
            memory: { type: 'test-memory' },
          };

          const userMessage = {
            role: Role.USER,
            content: 'Hello',
          };

          const result = await chatService.buildMemory(
            mockAgent as any,
            config,
            userMessage,
          );

          expect(result).toBe(mockMemory);
          expect(mockMemory.initialize).toHaveBeenCalledWith({
            systemPrompt: 'System prompt',
            userMessage,
          });
        },
      );
    });

    it('should pass system prompt and user message to initialize', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123', userId: 'user-123' },
        async () => {
          const mockMemory = {
            initialize: vi.fn().mockResolvedValue(undefined),
          };

          const mockAgent = {
            systemPrompt: {
              build: () => 'Custom system prompt',
            },
          };

          container.register('test-memory-2', { useValue: mockMemory });

          const userMessage = {
            role: Role.USER,
            content: 'Hello',
            attachments: [
              {
                filename: 'test.png',
                url: 'http://example.com/test.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          };

          await chatService.buildMemory(
            mockAgent as any,
            { memory: { type: 'test-memory-2' } },
            userMessage,
          );

          expect(mockMemory.initialize).toHaveBeenCalledWith({
            systemPrompt: 'Custom system prompt',
            userMessage,
          });
        },
      );
    });

    it('should use default memory type when not specified', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-456', userId: 'user-123' },
        async () => {
          const mockMemory = {
            initialize: vi.fn().mockResolvedValue(undefined),
          };

          const mockAgent = {
            systemPrompt: {
              build: vi.fn().mockReturnValue('System prompt'),
            },
          };

          // Register with the default memory type (NONE)
          container.register(MemoryIds.NONE, { useValue: mockMemory });

          const result = await chatService.buildMemory(
            mockAgent as any,
            {}, // no config
            { role: Role.USER, content: 'Hi' },
          );

          expect(result).toBe(mockMemory);
          expect(mockMemory.initialize).toHaveBeenCalled();
        },
      );
    });

    it('should handle undefined system prompt', async () => {
      await TraceContext.run(
        { requestId: 'test', conversationId: 'conv-123', userId: 'user-123' },
        async () => {
          const mockMemory = {
            initialize: vi.fn().mockResolvedValue(undefined),
          };

          const mockAgent = {
            systemPrompt: {
              build: () => undefined,
            },
          };

          container.register('test-memory-undefined', { useValue: mockMemory });

          const userMessage = {
            role: Role.USER,
            content: 'Hello',
          };

          await chatService.buildMemory(
            mockAgent as any,
            { memory: { type: 'test-memory-undefined' } },
            userMessage,
          );

          expect(mockMemory.initialize).toHaveBeenCalledWith({
            systemPrompt: undefined,
            userMessage,
          });
        },
      );
    });
  });
});
