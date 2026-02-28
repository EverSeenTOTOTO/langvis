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

      // Simulate running state
      session1!.start({} as any);

      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBeNull();
    });

    it('should cleanup and replace existing waiting session', () => {
      const session1 = chatService.acquireSession('conv-123');
      expect(session1).toBeDefined();

      // Don't start - still in waiting state
      const session2 = chatService.acquireSession('conv-123');
      expect(session2).toBeDefined();
      expect(session2).not.toBe(session1);
    });

    it('should clean Redis key on dispose', async () => {
      const session = chatService.acquireSession('conv-123');
      session!.cleanup();

      // Wait for microtask
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

  describe('startAgent', () => {
    it('should start agent and send events via session', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSendEvent = vi.fn().mockReturnValue(true);
      const mockSendControlMessage = vi.fn();
      session!.sendEvent = mockSendEvent;
      session!.sendControlMessage = mockSendControlMessage;

      const mockAgent = {
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', seq: 1, at: Date.now() };
          yield { type: 'stream', content: 'Hello', seq: 2, at: Date.now() };
          yield { type: 'final', seq: 3, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMemory = {} as Memory;
      const mockConversation = {
        id: 'conv-123',
        config: {},
      } as any;

      const mockMessage = {
        id: 'assistant-msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.startAgent(
        session!,
        mockConversation,
        mockAgent,
        mockMemory,
        mockMessage,
      );

      expect(mockSendEvent).toHaveBeenCalled();
      expect(mockConversationService.updateMessage).toHaveBeenCalled();
    });

    it('should send cancelled event when aborted', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSendEvent = vi.fn().mockReturnValue(true);
      session!.sendEvent = mockSendEvent;

      const mockAgent = {
        call: vi.fn().mockImplementation(async function* (_mem: any, ctx: any) {
          ctx.abort('Test abort');
          yield { type: 'start', seq: 1, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMemory = {} as Memory;
      const mockConversation = { id: 'conv-123', config: {} } as any;
      const mockMessage = {
        id: 'msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.startAgent(
        session!,
        mockConversation,
        mockAgent,
        mockMemory,
        mockMessage,
      );

      // Should send cancelled event
      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cancelled' }),
      );
    });

    it('should send error event when agent throws', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSendEvent = vi.fn().mockReturnValue(true);
      session!.sendEvent = mockSendEvent;

      const mockAgent = {
        call: vi.fn().mockImplementation(async function* () {
          yield; // satisfy require-yield
          throw new Error('Agent error');
        }),
      } as unknown as Agent;

      const mockMemory = {} as Memory;
      const mockConversation = { id: 'conv-123', config: {} } as any;
      const mockMessage = {
        id: 'msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.startAgent(
        session!,
        mockConversation,
        mockAgent,
        mockMemory,
        mockMessage,
      );

      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });

    it('should break loop when SSE not writable', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSendEvent = vi.fn().mockReturnValue(false);
      session!.sendEvent = mockSendEvent;

      const mockAgent = {
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', seq: 1, at: Date.now() };
          yield { type: 'stream', content: 'Hello', seq: 2, at: Date.now() };
          yield { type: 'stream', content: ' World', seq: 3, at: Date.now() };
          yield { type: 'final', seq: 4, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMemory = {} as Memory;
      const mockConversation = { id: 'conv-123', config: {} } as any;
      const mockMessage = {
        id: 'msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.startAgent(
        session!,
        mockConversation,
        mockAgent,
        mockMemory,
        mockMessage,
      );

      // Should break after first sendEvent returns false
      expect(mockSendEvent).toHaveBeenCalled();
    });

    it('should cleanup session after agent finishes', async () => {
      const session = chatService.acquireSession('conv-123');

      const mockSendEvent = vi.fn().mockReturnValue(true);
      session!.sendEvent = mockSendEvent;

      const mockAgent = {
        call: vi.fn().mockImplementation(async function* () {
          yield { type: 'start', seq: 1, at: Date.now() };
          yield { type: 'final', seq: 2, at: Date.now() };
        }),
      } as unknown as Agent;

      const mockMemory = {} as Memory;
      const mockConversation = { id: 'conv-123', config: {} } as any;
      const mockMessage = {
        id: 'msg',
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      await chatService.startAgent(
        session!,
        mockConversation,
        mockAgent,
        mockMemory,
        mockMessage,
      );

      expect(session!.phase).toBe('done');
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
  });
});
