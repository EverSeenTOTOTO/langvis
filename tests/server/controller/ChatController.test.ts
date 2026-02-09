import ChatController from '@/server/controller/ChatController';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container } from 'tsyringe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the container and agent
const mockAgent = {
  call: vi.fn(),
};

vi.mock('tsyringe', () => ({
  container: {
    resolve: vi.fn(),
    register: vi.fn(),
  },
  singleton: () => vi.fn(),
  inject: () => vi.fn(),
  injectable: () => vi.fn(),
}));

// Create mock service classes
class MockSSEService {
  initSSEConnection = vi.fn();
  closeSSEConnection = vi.fn();
  sendToConversation = vi.fn();
  sendToConnection = vi.fn();
}

class MockConversationService {
  addMessageToConversation = vi.fn();
  getMessagesByConversationId = vi.fn();
  getConversationById = vi.fn();
  updateMessage = vi.fn();
  createMessageStream = vi.fn();
  batchAddMessages = vi.fn();
}

class MockChatService {
  consumeAgentStream = vi.fn();
  cancelAgent = vi.fn();
  buildMemory = vi.fn();
}

let mockSSEService: MockSSEService;
let mockConversationService: MockConversationService;
let mockChatService: MockChatService;

describe('ChatController', () => {
  let chatController: ChatController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockWriteHead: ReturnType<typeof vi.fn>;
  let mockWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSSEService = new MockSSEService();
    mockConversationService = new MockConversationService();
    mockChatService = new MockChatService();
    chatController = new ChatController(
      mockSSEService as any,
      mockConversationService as any,
      mockChatService as any,
    );

    mockJson = vi.fn(() => mockResponse as Response);
    mockStatus = vi.fn(() => ({ json: mockJson }) as any);
    mockWriteHead = vi.fn();
    mockWrite = vi.fn();

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      writeHead: mockWriteHead,
      write: mockWrite,
    };

    mockRequest = {
      params: {},
      body: {},
      on: vi.fn(),
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: false,
        format: {},
        levels: {},
        level: 'info',
        prepend: false,
        exitOnError: true,
        emitErrs: false,
      } as any,
    };

    vi.clearAllMocks();
  });

  describe('initSSE', () => {
    it('should initialize an SSE connection', async () => {
      const conversationId = 'test-conversation-id';
      mockRequest.params = { conversationId };

      mockSSEService.initSSEConnection = vi
        .fn()
        .mockReturnValue('connection-id');

      await chatController.initSSE(
        conversationId,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockSSEService.initSSEConnection).toHaveBeenCalledWith(
        conversationId,
        mockResponse,
      );
      expect(mockRequest.on).toHaveBeenCalledWith(
        'close',
        expect.any(Function),
      );
      expect(mockRequest.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('should handle request close event during SSE connection', async () => {
      const conversationId = 'test-conversation-id';
      mockRequest.params = { conversationId };

      let closeCallback: (() => void) | undefined;
      (mockRequest.on as any).mockImplementation(
        (event: string, callback: () => void) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        },
      );

      await chatController.initSSE(
        conversationId,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Simulate close event
      closeCallback?.();

      expect(mockSSEService.closeSSEConnection).toHaveBeenCalledWith(
        conversationId,
      );
      expect(mockRequest.log?.info).toHaveBeenCalledWith(
        'SSE connection closed:',
        conversationId,
      );
    });

    it('should setup SSE connection with proper event handlers', async () => {
      const conversationId = 'test-conversation-id';
      mockRequest.params = { conversationId };

      await chatController.initSSE(
        conversationId,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify that both close and error handlers are registered
      expect(mockRequest.on).toHaveBeenCalledTimes(2);
      expect(mockRequest.on).toHaveBeenNthCalledWith(
        1,
        'close',
        expect.any(Function),
      );
      expect(mockRequest.on).toHaveBeenNthCalledWith(
        2,
        'error',
        expect.any(Function),
      );
    });
  });

  describe('chat', () => {
    it('should add a message to conversation and start agent call', async () => {
      const conversationId = 'test-conversation-id';
      const role = Role.USER;
      const content = 'Hello';
      const mockAssistantMessage = {
        id: '2',
        conversationId,
        role: Role.ASSIST,
        content: '',
        meta: { loading: true },
      };
      const mockConversation = {
        id: conversationId,
        name: 'Test Conversation',
        config: { agent: 'Chat Agent' },
      };
      const mockMemory = { id: 'memory-1' };

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      (container.resolve as any).mockReturnValue(mockAgent);

      mockConversationService.getConversationById = vi
        .fn()
        .mockResolvedValue(mockConversation);

      mockChatService.buildMemory = vi.fn().mockResolvedValue(mockMemory);

      mockConversationService.batchAddMessages = vi
        .fn()
        .mockResolvedValue([mockAssistantMessage]);

      mockAgent.call = vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'start', agentId: 'test' };
        },
      });

      await chatController.chat(
        conversationId,
        { conversationId, role, content },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
      expect(mockChatService.buildMemory).toHaveBeenCalled();
      expect(mockConversationService.batchAddMessages).toHaveBeenCalled();
      expect(mockChatService.consumeAgentStream).toHaveBeenCalled();
    });

    it('should return 400 if role is missing', async () => {
      const conversationId = 'test-conversation-id';
      const content = 'Hello';

      mockRequest.params = { conversationId };
      mockRequest.body = { conversationId, content };

      const { StartChatRequestDto } = await import('@/shared/dto/controller');

      try {
        await StartChatRequestDto.validate(mockRequest.body);
        throw new Error('Should have thrown validation error');
      } catch (error: any) {
        expect(error.name).toBe('ValidationException');
        expect(error.errors).toBeDefined();
        expect(error.errors).toContain('role');
      }
    });

    it('should return 400 if content is missing', async () => {
      const conversationId = 'test-conversation-id';
      const role = Role.USER;

      mockRequest.params = { conversationId };
      mockRequest.body = { conversationId, role };

      const { StartChatRequestDto } = await import('@/shared/dto/controller');

      try {
        await StartChatRequestDto.validate(mockRequest.body);
        throw new Error('Should have thrown validation error');
      } catch (error: any) {
        expect(error.name).toBe('ValidationException');
        expect(error.errors).toBeDefined();
        expect(error.errors).toContain('content');
      }
    });

    it('should return 400 if role is invalid', async () => {
      const conversationId = 'test-conversation-id';
      const role = 'invalid';
      const content = 'Hello';

      mockRequest.params = { conversationId };
      mockRequest.body = { conversationId, role, content };

      const { StartChatRequestDto } = await import('@/shared/dto/controller');

      try {
        await StartChatRequestDto.validate(mockRequest.body);
        throw new Error('Should have thrown validation error');
      } catch (error: any) {
        expect(error.name).toBe('ValidationException');
        expect(error.errors).toBeDefined();
        expect(error.errors).toContain('role');
      }
    });

    it('should return 404 if conversation is not found', async () => {
      const conversationId = 'nonexistent-conversation-id';
      const role = Role.USER;
      const content = 'Hello';
      const mockConversation = null;

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      mockConversationService.addMessageToConversation = vi
        .fn()
        .mockResolvedValue({ id: '1', conversationId, role, content });

      mockConversationService.getConversationById = vi
        .fn()
        .mockResolvedValue(mockConversation);

      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} not found`,
      });
    });

    it('should return 404 if initial message addition fails', async () => {
      const conversationId = 'test-conversation-id';
      const role = Role.USER;
      const content = 'Hello';

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      mockConversationService.addMessageToConversation = vi
        .fn()
        .mockResolvedValue(null);

      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} not found`,
      });
    });
  });

  describe('startAgent streaming logic', () => {
    let conversationId: string;
    let mockExistingMessages: any[];
    let mockConversation: any;

    beforeEach(() => {
      conversationId = 'test-conversation-id';
      mockExistingMessages = [
        { id: 'msg-1', role: Role.USER, content: 'Hello' },
      ];
      mockConversation = {
        id: conversationId,
        config: { agent: 'Chat Agent' },
      };

      // Setup mocks
      mockConversationService.getConversationById.mockResolvedValue(
        mockConversation,
      );
      mockConversationService.getMessagesByConversationId.mockResolvedValue(
        mockExistingMessages,
      );

      // Mock batchAddMessages to return inserted messages
      const mockInsertedMessages = [
        { id: 'user-msg', conversationId, role: Role.USER, content: 'Hello' },
        {
          id: 'assistant-msg',
          conversationId,
          role: Role.ASSIST,
          content: '',
          meta: { loading: true },
        },
      ];
      mockConversationService.batchAddMessages.mockResolvedValue(
        mockInsertedMessages,
      );

      mockConversationService.updateMessage.mockResolvedValue(undefined);

      // Mock consumeAgentStream
      mockChatService.consumeAgentStream = vi.fn().mockResolvedValue(undefined);

      // Mock buildMemory to return a mock memory object
      const mockMemory = { summarize: vi.fn(), store: vi.fn() };
      mockChatService.buildMemory = vi.fn().mockResolvedValue(mockMemory);

      // Mock container.resolve to return the mock agent
      vi.mocked(container.resolve).mockReturnValue(mockAgent);

      // Mock agent.call to return an AsyncGenerator
      mockAgent.call.mockImplementation(async function* () {
        yield { type: 'start', agentId: 'test' };
        yield { type: 'delta', content: 'Hello' };
        yield { type: 'end', agentId: 'test' };
      });

      mockRequest.params = { conversationId };
      mockRequest.body = { role: Role.USER, content: 'Hello' };
    });

    it('should initiate streaming when valid conversation and agent exist', async () => {
      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the chat method returns success
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });

      // Verify the agent was resolved and call was eventually called
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
    });

    it('should verify chat state and stream setup with correct parameters', async () => {
      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that call was called with Memory, Config, and Signal
      expect(mockAgent.call).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.anything(),
      );
    });

    it('should start agent processing that creates initial assistant message for streaming', async () => {
      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the assistant message placeholder was added
      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        conversationId,
        expect.arrayContaining([
          expect.objectContaining({
            role: Role.ASSIST,
            content: '',
            meta: { loading: true },
          }),
        ]),
      );

      // Verify the agent was resolved and call was eventually called
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
      expect(mockAgent.call).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.anything(),
      );
    });
  });

  describe('SSE and Streaming Integration', () => {
    let conversationId: string;
    let mockInitialMessage: any;
    let mockConversation: any;

    beforeEach(() => {
      conversationId = 'integration-test-conversation';
      mockInitialMessage = {
        id: 'integration-msg-id',
        conversationId,
        role: Role.ASSIST,
        content: '',
      };
      mockConversation = {
        id: conversationId,
        config: { agent: 'Chat Agent' },
      };

      mockConversationService.getConversationById.mockResolvedValue(
        mockConversation,
      );
      mockConversationService.getMessagesByConversationId.mockResolvedValue([]);

      // Mock batchAddMessages to return inserted messages
      const mockInsertedMessages = [
        {
          id: 'user-msg',
          conversationId,
          role: Role.USER,
          content: 'Test message',
        },
        mockInitialMessage,
      ];
      mockConversationService.batchAddMessages.mockResolvedValue(
        mockInsertedMessages,
      );

      mockConversationService.updateMessage.mockResolvedValue(undefined);

      // Mock consumeAgentStream
      mockChatService.consumeAgentStream = vi.fn().mockResolvedValue(undefined);

      // Mock buildMemory to return a mock memory object
      const mockMemory = { summarize: vi.fn(), store: vi.fn() };
      mockChatService.buildMemory = vi.fn().mockResolvedValue(mockMemory);

      vi.mocked(container.resolve).mockReturnValue(mockAgent);

      // Mock agent.call to return an AsyncGenerator
      mockAgent.call.mockImplementation(async function* () {
        yield { type: 'start', agentId: 'test' };
        yield { type: 'delta', content: 'Hello' };
        yield { type: 'end', agentId: 'test' };
      });

      mockRequest.params = { conversationId };
      mockRequest.body = { role: Role.USER, content: 'Test message' };
    });

    it('should setup streaming integration correctly', async () => {
      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the basic setup worked
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
      expect(mockConversationService.getConversationById).toHaveBeenCalledWith(
        conversationId,
      );

      // Verify batchAddMessages was called with the assistant message placeholder
      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        conversationId,
        expect.arrayContaining([
          expect.objectContaining({
            role: Role.ASSIST,
            content: '',
            meta: { loading: true },
          }),
        ]),
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify agent was resolved and call was initiated
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
      expect(mockAgent.call).toHaveBeenCalled();
    });

    it('should handle conversation not found during integration', async () => {
      mockConversationService.getConversationById.mockResolvedValue(null);

      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} not found`,
      });
      expect(mockAgent.call).not.toHaveBeenCalled();
    });

    it('should verify agent call with correct parameters', async () => {
      await chatController.chat(
        conversationId,
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that call was called with Memory, Config, and Signal
      expect(mockAgent.call).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.anything(),
      );
    });
  });

  describe('cancelChat', () => {
    it('should cancel an active stream successfully', async () => {
      mockRequest.params = {
        conversationId: 'conv-123',
      };
      mockRequest.body = {
        conversationId: 'conv-123',
        messageId: 'msg-456',
      };

      mockChatService.cancelAgent = vi.fn().mockResolvedValue(true);

      await chatController.cancelChat(
        'conv-123',
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockChatService.cancelAgent).toHaveBeenCalledWith(
        'conv-123',
        undefined,
      );
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
    });

    it('should return 404 when no active stream is found', async () => {
      mockRequest.params = {
        conversationId: 'conv-123',
      };
      mockRequest.body = {
        conversationId: 'conv-123',
        messageId: 'msg-456',
      };

      mockChatService.cancelAgent = vi.fn().mockResolvedValue(false);

      await chatController.cancelChat(
        'conv-123',
        mockRequest.body,
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockChatService.cancelAgent).toHaveBeenCalledWith(
        'conv-123',
        undefined,
      );
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'No active agent found for conversation conv-123',
      });
    });

    it('should return 400 when conversationId is missing', async () => {
      mockRequest.params = {};
      mockRequest.body = {
        messageId: 'msg-456',
      };

      mockChatService.cancelAgent = vi.fn();

      const { CancelChatRequestDto } = await import('@/shared/dto/controller');

      try {
        await CancelChatRequestDto.validate(mockRequest.body);
        throw new Error('Should have thrown validation error');
      } catch (error: any) {
        expect(error.name).toBe('ValidationException');
        expect(error.errors).toBeDefined();
        expect(error.errors).toContain('conversationId');
      }
    });

    it('should return 400 when messageId is missing', async () => {
      mockRequest.params = {
        conversationId: 'conv-123',
      };
      mockRequest.body = {
        conversationId: 'conv-123',
      };

      mockChatService.cancelAgent = vi.fn();

      const { CancelChatRequestDto } = await import('@/shared/dto/controller');

      try {
        await CancelChatRequestDto.validate(mockRequest.body);
        throw new Error('Should have thrown validation error');
      } catch (error: any) {
        expect(error.name).toBe('ValidationException');
        expect(error.errors).toBeDefined();
        expect(error.errors).toContain('messageId');
      }
    });
  });
});

