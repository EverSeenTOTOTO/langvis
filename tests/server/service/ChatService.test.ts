import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { ChatService } from '@/server/service/ChatService';
import { SSEService } from '@/server/service/SSEService';
import { AuthService } from '@/server/service/AuthService';
import { ConversationService } from '@/server/service/ConversationService';
import { Message, Role } from '@/shared/entities/Message';
import { AgentEvent } from '@/shared/types';
import type { Request } from 'express';

vi.mock('globby', () => ({
  globby: vi.fn().mockResolvedValue([]),
}));

describe('ChatService', () => {
  let chatService: ChatService;
  let mockSSEService: any;
  let mockAuthService: any;
  let mockConversationService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockSSEService = {
      sendToConversation: vi.fn(),
    };

    mockAuthService = {
      getUserId: vi.fn().mockResolvedValue('user-123'),
    };

    mockConversationService = {
      updateMessage: vi.fn().mockResolvedValue(undefined),
    };

    container.register(SSEService, { useValue: mockSSEService });
    container.register(AuthService, { useValue: mockAuthService });
    container.register(ConversationService, {
      useValue: mockConversationService,
    });

    chatService = container.resolve(ChatService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('cancelAgent', () => {
    it('should cancel active agent', async () => {
      const conversationId = 'conv-123';
      const controller = new AbortController();

      (chatService as any).activeAgents.set(conversationId, controller);

      const result = await chatService.cancelAgent(conversationId);

      expect(result).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('should return false if no active agent', async () => {
      const result = await chatService.cancelAgent('non-existent');
      expect(result).toBe(false);
    });

    it('should handle cancellation with custom reason', async () => {
      const conversationId = 'conv-123';
      const controller = new AbortController();

      (chatService as any).activeAgents.set(conversationId, controller);

      const result = await chatService.cancelAgent(
        conversationId,
        'Custom cancel reason',
      );

      expect(result).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('should handle errors during cancellation', async () => {
      const conversationId = 'conv-123';
      const mockController = {
        abort: vi.fn().mockImplementation(() => {
          throw new Error('Abort failed');
        }),
      };

      (chatService as any).activeAgents.set(conversationId, mockController);

      const result = await chatService.cancelAgent(conversationId);

      expect(result).toBe(false);
    });
  });

  describe('consumeAgentStream', () => {
    it('should handle complete agent stream', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'delta', content: 'Hello' };
        yield { type: 'delta', content: ' World' };
        yield { type: 'end', agentId: 'test-agent' };
      }

      const controller = new AbortController();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(message.content).toBe('Hello World');
      expect(mockSSEService.sendToConversation).toHaveBeenCalled();
      expect(mockConversationService.updateMessage).toHaveBeenCalledWith(
        'msg-123',
        'Hello World',
        expect.any(Object),
      );
    });

    it('should handle meta updates', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'meta', meta: { thinking: 'Processing...' } };
        yield { type: 'end', agentId: 'test-agent' };
      }

      const controller = new AbortController();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(message.meta).toMatchObject({
        thinking: 'Processing...',
      });
    });

    it('should handle abort signal', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'delta', content: 'Hello' };
      }

      const controller = new AbortController();
      controller.abort();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(mockSSEService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_done' },
      );
    });

    it('should handle streaming errors', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'error', error: new Error('Test error') };
      }

      const controller = new AbortController();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(mockConversationService.updateMessage).toHaveBeenCalledWith(
        'msg-123',
        'Test error',
        expect.objectContaining({ error: true }),
      );

      expect(mockSSEService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_error', error: 'Test error' },
      );
    });

    it('should handle update message failure', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      mockConversationService.updateMessage.mockRejectedValue(
        new Error('Update failed'),
      );

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'error', error: new Error('Stream error') };
      }

      const controller = new AbortController();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(mockSSEService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_error', error: 'Stream error' },
      );
    });

    it('should track first chunk timing', async () => {
      const conversationId = 'conv-123';
      const message: Message = {
        id: 'msg-123',
        content: '',
        role: Role.ASSIST,
        conversationId,
        meta: {},
        createdAt: new Date(),
      };

      async function* mockGenerator(): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'start', agentId: 'test-agent' };
        yield { type: 'delta', content: 'First' };
        yield { type: 'delta', content: ' Second' };
        yield { type: 'end', agentId: 'test-agent' };
      }

      const controller = new AbortController();

      await chatService.consumeAgentStream(
        conversationId,
        message,
        mockGenerator(),
        controller,
      );

      expect(mockSSEService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        expect.objectContaining({
          type: 'completion_delta',
          meta: expect.objectContaining({
            streaming: true,
            loading: false,
          }),
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
      } as unknown as Request;

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
      expect(mockMemory.summarize).toHaveBeenCalled();
      expect(mockMemory.store).toHaveBeenCalled();
      expect(result).toBe(mockMemory);
    });

    it('should add system prompt for new conversation', async () => {
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
      } as unknown as Request;

      const config = {
        memory: { type: 'test-memory' },
      };

      const userMessage = {
        role: Role.USER,
        content: 'Hello',
      };

      await chatService.buildMemory(req, mockAgent as any, config, userMessage);

      expect(mockMemory.store).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: Role.SYSTEM,
            content: 'System prompt',
          }),
          expect.objectContaining({
            role: Role.USER,
            content: 'Hello',
          }),
        ]),
      );
    });

    it('should not add system prompt for existing conversation', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi
          .fn()
          .mockResolvedValue([
            { role: Role.SYSTEM, content: 'Existing prompt' },
          ]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {
        getSystemPrompt: vi.fn().mockResolvedValue('System prompt'),
      };

      container.register('test-memory', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-123' },
      } as unknown as Request;

      const config = {
        memory: { type: 'test-memory' },
      };

      const userMessage = {
        role: Role.USER,
        content: 'Hello',
      };

      await chatService.buildMemory(req, mockAgent as any, config, userMessage);

      expect(mockMemory.store).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: Role.USER,
            content: 'Hello',
          }),
        ]),
      );

      expect(mockMemory.store).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: Role.SYSTEM,
          }),
        ]),
      );
    });

    it('should handle agent without getSystemPrompt', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {};

      container.register('test-memory', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-123' },
      } as unknown as Request;

      const config = {
        memory: { type: 'test-memory' },
      };

      const userMessage = {
        role: Role.USER,
        content: 'Hello',
      };

      await chatService.buildMemory(req, mockAgent as any, config, userMessage);

      expect(mockMemory.store).toHaveBeenCalledWith([
        expect.objectContaining({
          role: Role.USER,
          content: 'Hello',
        }),
      ]);
    });

    it('should handle user message with meta', async () => {
      const mockMemory = {
        setConversationId: vi.fn(),
        setUserId: vi.fn(),
        summarize: vi.fn().mockResolvedValue([]),
        store: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {};

      container.register('test-memory', { useValue: mockMemory });

      const req = {
        params: { conversationId: 'conv-123' },
      } as unknown as Request;

      const config = {
        memory: { type: 'test-memory' },
      };

      const userMessage = {
        role: Role.USER,
        content: 'Hello',
        meta: { source: 'web' },
      };

      await chatService.buildMemory(req, mockAgent as any, config, userMessage);

      expect(mockMemory.store).toHaveBeenCalledWith([
        expect.objectContaining({
          role: Role.USER,
          content: 'Hello',
          meta: { source: 'web' },
        }),
      ]);
    });
  });
});
