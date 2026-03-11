import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { AuthService } from '@/server/service/AuthService';
import { ConversationService } from '@/server/service/ConversationService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { PendingMessage } from '@/server/core/PendingMessage';
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
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
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

    it('should return null if session already running', async () => {
      const session1 = chatService.acquireSession('conv-123');
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

      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBe(session1); // Reconnection returns same session

      session1!.cancel('test done');
      await runPromise;
    });

    it('should return existing waiting session for reconnection', () => {
      const session1 = chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBeDefined();
      expect(session2).toBe(session1); // Same session for reconnection
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

      const pendingMessage = new PendingMessage(
        mockMessage,
        mockConversationService.updateMessage,
      );
      session!.bindPendingMessage(pendingMessage);

      await chatService.runSession(session!, mockAgent, {} as Memory, {});

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
    it('should build memory with conversation context', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {
        systemPrompt: {
          build: () => 'System prompt',
          with: vi.fn().mockReturnThis(),
        },
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
        systemPrompt: {
          build: () => 'System prompt',
          with: vi.fn().mockReturnThis(),
        },
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

    it('should inject Background section with conversationId and userId', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      let capturedBackground = '';
      const mockAgent = {
        systemPrompt: {
          build: vi
            .fn()
            .mockReturnValue(
              '## Background\nTest Content\n\n## Role\nAssistant',
            ),
          with: vi.fn().mockImplementation((_name: string, content: string) => {
            capturedBackground = content;
            return mockAgent.systemPrompt;
          }),
        },
      };

      container.register('test-memory-3', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-456' },
      } as any;

      await chatService.buildMemory(
        req,
        mockAgent as any,
        { memory: { type: 'test-memory-3' } },
        { role: Role.USER, content: 'Hi' },
      );

      expect(mockAgent.systemPrompt.with).toHaveBeenCalledWith(
        'Background',
        expect.any(String),
      );
      expect(capturedBackground).toContain('Conversation ID: conv-456');
      expect(capturedBackground).toContain('User ID: user-123');
    });

    it('should inject Background with only conversationId when userId is null', async () => {
      mockAuthService.getUserId = vi.fn().mockResolvedValue(null);

      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      let capturedBackground = '';
      const mockAgent = {
        systemPrompt: {
          build: vi.fn().mockReturnValue('System'),
          with: vi.fn().mockImplementation((_name: string, content: string) => {
            capturedBackground = content;
            return mockAgent.systemPrompt;
          }),
        },
      };

      container.register('test-memory-4', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-789' },
      } as any;

      await chatService.buildMemory(
        req,
        mockAgent as any,
        { memory: { type: 'test-memory-4' } },
        { role: Role.USER, content: 'Hi' },
      );

      expect(capturedBackground).toBe('Conversation ID: conv-789');
    });

    it('should inject Background with only userId when conversationId is empty', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      let capturedBackground = '';
      const mockAgent = {
        systemPrompt: {
          build: vi.fn().mockReturnValue('System'),
          with: vi.fn().mockImplementation((_name: string, content: string) => {
            capturedBackground = content;
            return mockAgent.systemPrompt;
          }),
        },
      };

      container.register('test-memory-5', { useValue: mockMemory });

      const req = {
        params: { conversationId: '' },
      } as any;

      await chatService.buildMemory(
        req,
        mockAgent as any,
        { memory: { type: 'test-memory-5' } },
        { role: Role.USER, content: 'Hi' },
      );

      expect(capturedBackground).toBe('User ID: user-123');
    });
  });
});
