import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import { InjectTokens, RedisKeys } from '@/shared/constants';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockRedis = {
      del: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    };

    container.register(InjectTokens.REDIS, { useValue: mockRedis });

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

      expect(mockRedis.del).toHaveBeenCalledWith(
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
    it('should build memory with conversationId and userId', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
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
        'conv-123',
        'user-123',
        config,
        userMessage,
      );

      expect(mockMemory.setConversationId).toHaveBeenCalledWith('conv-123');
      expect(mockMemory.setUserId).toHaveBeenCalledWith('user-123');
      expect(result).toBe(mockMemory);
    });

    it('should store system prompt, session context, and user message with sequential timestamps', async () => {
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
        },
      };

      container.register('test-memory-2', { useValue: mockMemory });

      const config = { memory: { type: 'test-memory-2' } };

      await chatService.buildMemory(
        mockAgent as any,
        'conv-123',
        'user-123',
        config,
        { role: Role.USER, content: 'Hello' },
      );

      // System + session context + user message
      expect(storedMessages).toHaveLength(3);
      expect(storedMessages[0].role).toBe(Role.SYSTEM);
      expect(storedMessages[1].role).toBe(Role.USER);
      expect(storedMessages[1].content).toContain('<session-context>');
      expect(storedMessages[2].role).toBe(Role.USER);
      expect(storedMessages[2].content).toBe('Hello');
      expect(storedMessages[0].createdAt.getTime()).toBeLessThan(
        storedMessages[1].createdAt.getTime(),
      );
      expect(storedMessages[1].createdAt.getTime()).toBeLessThan(
        storedMessages[2].createdAt.getTime(),
      );
    });

    it('should add session context as user message before actual user message', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {
        systemPrompt: {
          build: vi
            .fn()
            .mockReturnValue(
              '## Background\nTest Content\n\n## Role\nAssistant',
            ),
        },
      };

      container.register('test-memory-3', { useValue: mockMemory });

      await chatService.buildMemory(
        mockAgent as any,
        'conv-456',
        'user-123',
        { memory: { type: 'test-memory-3' } },
        { role: Role.USER, content: 'Hi' },
      );

      const storedMessages = mockMemory.store.mock.calls[0][0];
      // System message + session context user message + actual user message
      expect(storedMessages).toHaveLength(3);
      expect(storedMessages[0].role).toBe(Role.SYSTEM);
      expect(storedMessages[1].role).toBe(Role.USER);
      expect(storedMessages[1].content).toContain('<session-context>');
      expect(storedMessages[1].content).toContain('Conversation ID: conv-456');
      expect(storedMessages[1].content).toContain('User ID: user-123');
      expect(storedMessages[2].role).toBe(Role.USER);
      expect(storedMessages[2].content).toBe('Hi');
    });

    it('should store user message with attachments', async () => {
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
        },
      };

      container.register('test-memory-attachments', { useValue: mockMemory });

      const attachments = [
        {
          filename: 'test.png',
          url: 'https://example.com/test.png',
          mimeType: 'image/png',
          size: 1024,
        },
      ];

      await chatService.buildMemory(
        mockAgent as any,
        'conv-123',
        'user-123',
        { memory: { type: 'test-memory-attachments' } },
        { role: Role.USER, content: 'What is this?', attachments },
      );

      // Find the actual user message (not the session context)
      const userMsg = storedMessages.find(
        m => m.role === Role.USER && m.content === 'What is this?',
      );
      expect(userMsg).toBeDefined();
      expect(userMsg.attachments).toEqual(attachments);
    });
  });
});
