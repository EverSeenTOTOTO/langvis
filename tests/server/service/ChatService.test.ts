import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { DatabaseService } from '@/server/service/DatabaseService';
import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { PendingMessage } from '@/server/core/PendingMessage';
import { Role } from '@/shared/entities/Message';
import { RedisKeys } from '@/shared/constants';
import { RedisService } from '@/server/service/RedisService';
import { ConversationService } from '@/server/service/ConversationService';
import { WorkspaceService } from '@/server/service/WorkspaceService';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockRedisService: any;
  let mockConversationService: any;
  let mockDb: DatabaseService;

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
      getMessagesByConversationId: vi.fn().mockResolvedValue([]),
      batchAddMessages: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue([]),
      updateMessage: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock DatabaseService
    mockDb = {
      dataSource: {
        getRepository: vi.fn(),
        query: vi.fn(),
      },
    } as unknown as DatabaseService;

    const mockWorkspaceService = {
      getWorkDir: vi.fn().mockResolvedValue('/tmp/workspace'),
    };

    container.register(DatabaseService, { useValue: mockDb });
    container.register(RedisService, { useValue: mockRedisService });
    container.register(ConversationService, {
      useValue: mockConversationService,
    });
    container.register(WorkspaceService as any, {
      useValue: mockWorkspaceService,
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

      // Bind mock transport
      const mockTransport = {
        get isConnected() {
          return true;
        },
        send: vi.fn().mockReturnValue(true),
        close: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
      session1!.attachTransport(mockTransport as any);

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

      const mockTransport = {
        get isConnected() {
          return true;
        },
        send: vi.fn().mockReturnValue(true),
        close: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
      session!.attachTransport(mockTransport as any);

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

      const mockMemory = {
        summarize: vi.fn().mockResolvedValue([]),
        completeTurn: vi.fn(),
        notifyContextUsage: vi.fn(),
      } as unknown as Memory;

      session!.setMemory(mockMemory);

      const mockMessage = {
        id: MSG_ID,
        role: Role.ASSIST,
        content: '',
        meta: { events: [] },
        createdAt: new Date(),
        conversationId: 'conv-123',
      };

      const pendingMessage = new PendingMessage(mockMessage);
      session!.addMessageFSM(mockMessage.id, pendingMessage);

      await chatService.runSession(session!, mockAgent, {}, mockMessage.id);

      expect(mockAgent.call).toHaveBeenCalled();
      expect(mockMemory.completeTurn).toHaveBeenCalled();
      expect(session!.phase).toBe('waiting');
    });
  });

  describe('prepareTurn', () => {
    it('should construct all messages for first turn', async () => {
      mockConversationService.getMessagesByConversationId.mockResolvedValue([]);

      const result = await chatService.prepareTurn({
        conversationId: 'conv-123',
        userId: 'user-1',
        systemPrompt: 'You are a helpful assistant.',
        userMessage: {
          role: Role.USER,
          content: 'Hello',
        },
      });

      expect(result.messages.length).toBe(4); // system + session context + user + assistant
      expect(result.messages[0].role).toBe(Role.SYSTEM);
      expect(result.messages[0].content).toBe('You are a helpful assistant.');
      expect(result.messages[1].role).toBe(Role.USER);
      expect(result.messages[1].meta).toEqual({ hidden: true });
      expect(result.messages[2].role).toBe(Role.USER);
      expect(result.messages[2].content).toBe('Hello');
      expect(result.messages[3].role).toBe(Role.ASSIST);
      expect(result.assistantId).toBe(result.messages[3].id);
    });

    it('should include existing history for subsequent turns', async () => {
      mockConversationService.getMessagesByConversationId.mockResolvedValue([
        {
          id: 'msg-1',
          role: Role.SYSTEM,
          content: 'System',
          createdAt: new Date(),
          conversationId: 'conv-123',
        },
      ]);

      const result = await chatService.prepareTurn({
        conversationId: 'conv-123',
        userId: 'user-1',
        systemPrompt: 'You are a helpful assistant.',
        userMessage: {
          role: Role.USER,
          content: 'Follow up',
        },
      });

      // existing (1) + new user + new assistant = 3
      expect(result.messages.length).toBe(3);
      expect(result.messages[0].role).toBe(Role.SYSTEM);
      expect(result.messages[1].role).toBe(Role.USER);
      expect(result.messages[1].content).toBe('Follow up');
      expect(result.messages[2].role).toBe(Role.ASSIST);
      expect(result.assistantMessage).toBeDefined();
      expect(result.assistantMessage.id).toBe(result.assistantId);
    });

    it('should async persist messages', async () => {
      mockConversationService.getMessagesByConversationId.mockResolvedValue([]);
      mockConversationService.batchAddMessages.mockResolvedValue([]);

      await chatService.prepareTurn({
        conversationId: 'conv-123',
        userId: 'user-1',
        systemPrompt: 'System',
        userMessage: {
          role: Role.USER,
          content: 'Hello',
        },
      });

      // Wait for async persist
      await vi.waitFor(() => {
        expect(mockConversationService.batchAddMessages).toHaveBeenCalled();
      });

      const [conversationId, messages] =
        mockConversationService.batchAddMessages.mock.calls[0];
      expect(conversationId).toBe('conv-123');
      expect(messages.length).toBe(4);
    });
  });
});
