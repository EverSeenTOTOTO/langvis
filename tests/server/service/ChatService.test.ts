import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { PendingMessage } from '@/server/core/PendingMessage';
import { TraceContext } from '@/server/core/TraceContext';
import { Role } from '@/shared/entities/Message';
import { MemoryIds, RedisKeys } from '@/shared/constants';
import { RedisService } from '@/server/service/RedisService';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockRedisService: any;

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

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(RedisService, { useValue: mockRedisService });

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

      // Bind mock connection and pending message
      const mockConn = {
        conversationId: 'conv-123',
        get isWritable() {
          return true;
        },
        send: vi.fn().mockReturnValue(true),
        close: vi.fn(),
      };
      session1!.bindConnection(mockConn as any);

      const pendingMessage = new PendingMessage(
        {
          id: 'msg',
          role: Role.ASSIST,
          content: '',
          meta: { events: [] },
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        vi.fn().mockResolvedValue(undefined),
      );
      session1!.bindPendingMessage(pendingMessage);

      const mockAgent = {
        id: 'test',
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', seq: 1, at: Date.now() };
          await new Promise(resolve => setTimeout(resolve, 200));
          yield { type: 'final', seq: 2, at: Date.now() };
        }),
      } as unknown as Agent;

      const runPromise = session1!.run(mockAgent, {} as Memory, {});

      const session2 = await chatService.acquireSession('conv-123');
      expect(session2).toBe(session1); // Reconnection returns same session

      session1!.cancel('test done');
      await runPromise;
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
        RedisKeys.HUMAN_INPUT('conv-123'),
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
    it('should delegate to session.run and finalize message', async () => {
      const session = await chatService.acquireSession('conv-123');

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
          yield { type: 'start', seq: 1, at: Date.now() };
          yield { type: 'stream', content: 'Hello', seq: 2, at: Date.now() };
          yield { type: 'final', seq: 3, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMessage = {
        id: 'assistant-msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      const updateMessage = vi.fn().mockResolvedValue(undefined);
      const pendingMessage = new PendingMessage(mockMessage, updateMessage);
      session!.bindPendingMessage(pendingMessage);

      await chatService.runSession(session!, mockAgent, {} as Memory, {});

      expect(mockAgent.call).toHaveBeenCalled();
      expect(updateMessage).toHaveBeenCalled();
      expect(session!.phase).toBe('done');
    });

    it('should handle infrastructure errors with send', async () => {
      const session = await chatService.acquireSession('conv-123');

      const mockSend = vi.fn();
      session!.send = mockSend;

      // Mock run to throw before agent starts (infrastructure error)
      session!.run = vi.fn().mockRejectedValue(new Error('Infra error'));

      const mockAgent = { id: 'test' } as unknown as Agent;
      await chatService.runSession(session!, mockAgent, {} as Memory, {});

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session_error',
          error: 'Infra error',
        }),
      );
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
