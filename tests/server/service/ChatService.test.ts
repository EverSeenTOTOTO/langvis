import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { AuthService } from '@/server/service/AuthService';
import { ConversationService } from '@/server/service/ConversationService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { Role } from '@/shared/entities/Message';
import { InjectTokens } from '@/shared/constants';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockAuthService: any;
  let mockConversationService: any;
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockAuthService = {
      getUserId: vi.fn().mockResolvedValue('user-123'),
    };

    mockConversationService = {
      updateMessage: vi.fn().mockResolvedValue(undefined),
      batchAddMessages: vi.fn().mockResolvedValue([
        {
          id: 'user-msg',
          role: Role.USER,
          content: 'Hello',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
        {
          id: 'assistant-msg',
          role: Role.ASSIST,
          content: '',
          conversationId: 'conv-123',
          createdAt: new Date(),
        },
      ]),
    };

    mockRedis = {
      del: vi.fn().mockResolvedValue(undefined),
    };

    container.register(AuthService, { useValue: mockAuthService });
    container.register(ConversationService, {
      useValue: mockConversationService,
    });
    container.register(InjectTokens.REDIS, { useValue: mockRedis });

    chatService = container.resolve(ChatService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('acquireSession', () => {
    it('should create new session for conversation', () => {
      const session = chatService.acquireSession('conv-123');

      expect(session).toBeDefined();
      expect(session?.conversationId).toBe('conv-123');
      expect(session?.phase).toBe('waiting');
    });

    it('should return null if session already running', () => {
      const session1 = chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      // Simulate running state via run()
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
      };
      session1!.bindConnection(mockConn as any);

      const mockAgent = {
        id: 'test',
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', seq: 1, at: Date.now() };
          // Keep running so session stays in 'running' phase
          await new Promise(resolve => setTimeout(resolve, 200));
          yield { type: 'final', seq: 2, at: Date.now() };
        }),
      } as unknown as Agent;

      const runPromise = session1!.run(
        mockAgent,
        {} as Memory,
        {
          id: 'msg',
          role: Role.ASSIST,
          content: '',
          meta: { events: [] },
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
        {},
        vi.fn().mockResolvedValue(undefined),
      );

      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBeNull();

      // Cleanup: cancel and wait
      session1!.cancel('test done');
      return runPromise;
    });

    it('should cleanup and replace existing waiting session', () => {
      const session1 = chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBeDefined();
      expect(session2).not.toBe(session1);
    });

    it('should clean Redis key on dispose', async () => {
      const session = chatService.acquireSession('conv-123');
      session!.cleanup();

      await Promise.resolve();

      expect(mockRedis.del).toHaveBeenCalledWith('human_input:conv-123');
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      const session = chatService.getSession('non-existent');
      expect(session).toBeUndefined();
    });

    it('should return existing session', () => {
      chatService.acquireSession('conv-123');
      const session = chatService.getSession('conv-123');

      expect(session).toBeDefined();
      expect(session?.conversationId).toBe('conv-123');
    });
  });

  describe('runSession', () => {
    it('should delegate to session.run and finalize message', async () => {
      const session = chatService.acquireSession('conv-123');

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

      await chatService.runSession(
        session!,
        mockAgent,
        {} as Memory,
        mockMessage,
        {},
      );

      expect(mockAgent.call).toHaveBeenCalled();
      expect(mockConversationService.updateMessage).toHaveBeenCalled();
      expect(session!.phase).toBe('done');
    });

    it('should handle infrastructure errors with send', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSend = vi.fn();
      session!.send = mockSend;

      // Mock run to throw before agent starts (infrastructure error)
      session!.run = vi.fn().mockRejectedValue(new Error('Infra error'));

      const mockAgent = { id: 'test' } as unknown as Agent;
      const mockMessage = {
        id: 'msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.runSession(
        session!,
        mockAgent,
        {} as Memory,
        mockMessage,
        {},
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session_error',
          error: 'Infra error',
        }),
      );
    });
  });

  describe('buildMemory', () => {
    it('should build memory with conversation context', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {
        getSystemPrompt: vi.fn().mockResolvedValue('System prompt'),
      };

      container.register('test-memory', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-123' },
      } as any;

      const config = {
        memory: { type: 'test-memory' },
      };

      const userMessage = {
        role: Role.USER,
        content: 'Hello',
      };

      const result = await chatService.buildMemory(
        req,
        mockAgent as any,
        config,
        userMessage,
      );

      expect(mockMemory.setConversationId).toHaveBeenCalledWith('conv-123');
      expect(mockMemory.setUserId).toHaveBeenCalledWith('user-123');
      expect(result).toBe(mockMemory);
    });

    it('should store system prompt and user message with sequential timestamps', async () => {
      const storedMessages: any[] = [];
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockImplementation((msgs: any[]) => {
          storedMessages.push(...msgs);
        }),
      };

      const mockAgent = {
        getSystemPrompt: vi.fn().mockResolvedValue('System prompt'),
      };

      container.register('test-memory-2', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-123' },
      } as any;

      const config = { memory: { type: 'test-memory-2' } };

      await chatService.buildMemory(req, mockAgent as any, config, {
        role: Role.USER,
        content: 'Hello',
      });

      expect(storedMessages).toHaveLength(2);
      expect(storedMessages[0].role).toBe(Role.SYSTEM);
      expect(storedMessages[1].role).toBe(Role.USER);
      expect(storedMessages[0].createdAt.getTime()).toBeLessThan(
        storedMessages[1].createdAt.getTime(),
      );
    });
  });
});
