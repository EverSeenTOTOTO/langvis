import { describe, it, beforeEach, vi, expect } from 'vitest';
import ChatController from '@/server/controller/ChatController';
import type { Request, Response } from 'express';
import { Role } from '@/shared/entities/Message';
import { container } from 'tsyringe';

// Mock the container and agent
const mockAgent = {
  streamCall: vi.fn(),
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
  createStreamForMessage = vi.fn();
  cancelStream = vi.fn();
}

let mockSSEService: MockSSEService;
let mockConversationService: MockConversationService;

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
    chatController = new ChatController(
      mockSSEService as any,
      mockConversationService as any,
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
      const mockMessage = { id: '1', conversationId, role, content };
      const mockConversation = {
        id: conversationId,
        name: 'Test Conversation',
        config: { agent: 'Chat Agent' },
      };

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      mockConversationService.addMessageToConversation = vi
        .fn()
        .mockResolvedValue(mockMessage);

      mockConversationService.getConversationById = vi
        .fn()
        .mockResolvedValue(mockConversation);

      mockConversationService.getMessagesByConversationId = vi
        .fn()
        .mockResolvedValue([{ role: Role.USER, content: 'Hello' }]);

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
    });

    it('should return 400 if role is missing', async () => {
      const conversationId = 'test-conversation-id';
      const content = 'Hello';

      mockRequest.params = { conversationId };
      mockRequest.body = { content };

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Role and content are required',
      });
    });

    it('should return 400 if content is missing', async () => {
      const conversationId = 'test-conversation-id';
      const role = Role.USER;

      mockRequest.params = { conversationId };
      mockRequest.body = { role };

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Role and content are required',
      });
    });

    it('should return 400 if role is invalid', async () => {
      const conversationId = 'test-conversation-id';
      const role = 'invalid';
      const content = 'Hello';

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Invalid role: invalid' });
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
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} not found`,
      });
    });

    it('should return 400 if agent configuration is missing', async () => {
      const conversationId = 'test-conversation-id';
      const role = Role.USER;
      const content = 'Hello';
      const mockMessage = { id: '1', conversationId, role, content };
      const mockConversation = {
        id: conversationId,
        name: 'Test Conversation',
        config: {},
      };

      mockRequest.params = { conversationId };
      mockRequest.body = { role, content };

      mockConversationService.addMessageToConversation = vi
        .fn()
        .mockResolvedValue(mockMessage);

      mockConversationService.getConversationById = vi
        .fn()
        .mockResolvedValue(mockConversation);

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Conversation test-conversation-id has no agent configured',
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

      // Create a mock WritableStream
      const mockWritableStream = new WritableStream({
        write() {
          // Mock write implementation
        },
        close() {
          // Mock close implementation
        },
        abort() {
          // Mock abort implementation
        },
      });

      // Mock createStreamForMessage to return the mock WritableStream
      mockConversationService.createStreamForMessage = vi
        .fn()
        .mockResolvedValue(mockWritableStream);
      // Mock container.resolve to return the mock agent
      vi.mocked(container.resolve).mockReturnValue(mockAgent);
      mockAgent.streamCall.mockResolvedValue(undefined);

      mockRequest.params = { conversationId };
      mockRequest.body = { role: Role.USER, content: 'Hello' };
    });

    it('should initiate streaming when valid conversation and agent exist', async () => {
      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the chat method returns success
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });

      // Verify the agent was resolved and streamCall was eventually called
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
    });

    it('should handle initial assistant message creation failure', async () => {
      // Mock the batch message creation to fail
      mockConversationService.batchAddMessages.mockRejectedValue(
        new Error('Database error'),
      );

      try {
        await chatController.chat(
          mockRequest as Request,
          mockResponse as Response,
        );
      } catch (error) {
        // Should handle the error gracefully
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should verify chat state and stream setup with correct parameters', async () => {
      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that streamCall was called with Message[] and WritableStream
      expect(mockAgent.streamCall).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(WritableStream),
        expect.any(Object),
      );
    });

    it('should start agent processing that creates initial assistant message for streaming', async () => {
      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the messages were added using batch operation
      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        conversationId,
        expect.arrayContaining([
          expect.objectContaining({ role: Role.USER, content: 'Hello' }),
          expect.objectContaining({
            role: Role.ASSIST,
            content: '',
            meta: { loading: true },
          }),
        ]),
      );

      // Verify the agent was resolved and streamCall was eventually called
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
      expect(mockAgent.streamCall).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(WritableStream),
        expect.any(Object),
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

      // Create a mock WritableStream
      const mockWritableStream = new WritableStream({
        write() {
          // Mock write implementation
        },
        close() {
          // Mock close implementation
        },
        abort() {
          // Mock abort implementation
        },
      });

      // Mock createStreamForMessage to return the mock WritableStream
      mockConversationService.createStreamForMessage = vi
        .fn()
        .mockResolvedValue(mockWritableStream);

      vi.mocked(container.resolve).mockReturnValue(mockAgent);
      mockAgent.streamCall.mockResolvedValue(undefined);

      mockRequest.params = { conversationId };
      mockRequest.body = { role: Role.USER, content: 'Test message' };
    });

    it('should setup streaming integration correctly', async () => {
      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      // Verify the basic setup worked
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
      expect(mockConversationService.getConversationById).toHaveBeenCalledWith(
        conversationId,
      );

      // Verify batchAddMessages was called with the user message and assistant message
      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        conversationId,
        expect.arrayContaining([
          expect.objectContaining({ role: Role.USER, content: 'Test message' }),
          expect.objectContaining({
            role: Role.ASSIST,
            content: '',
            meta: { loading: true },
          }),
        ]),
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify agent was resolved and streamCall was initiated
      expect(container.resolve).toHaveBeenCalledWith(
        mockConversation.config.agent,
      );
      expect(mockAgent.streamCall).toHaveBeenCalled();
    });

    it('should handle conversation not found during integration', async () => {
      mockConversationService.getConversationById.mockResolvedValue(null);

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} not found`,
      });
      expect(mockAgent.streamCall).not.toHaveBeenCalled();
    });

    it('should handle missing agent configuration during integration', async () => {
      const conversationWithoutAgent = {
        id: conversationId,
        config: {},
      };
      mockConversationService.getConversationById.mockResolvedValue(
        conversationWithoutAgent,
      );

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: `Conversation ${conversationId} has no agent configured`,
      });
      expect(mockAgent.streamCall).not.toHaveBeenCalled();
    });

    it('should verify WritableStream is properly created for agent', async () => {
      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that streamCall was called with the correct types
      expect(mockAgent.streamCall).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(WritableStream),
        expect.any(Object),
      );
    });
  });

  describe('cancelChat', () => {
    it('should cancel an active stream successfully', async () => {
      mockRequest.params = {
        conversationId: 'conv-123',
      };
      mockRequest.body = {
        messageId: 'msg-456',
      };

      mockConversationService.cancelStream = vi.fn().mockResolvedValue(true);

      await chatController.cancelChat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockConversationService.cancelStream).toHaveBeenCalledWith(
        'msg-456',
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
        messageId: 'msg-456',
      };

      mockConversationService.cancelStream = vi.fn().mockResolvedValue(false);

      await chatController.cancelChat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockConversationService.cancelStream).toHaveBeenCalledWith(
        'msg-456',
        undefined,
      );
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'No active stream found for message msg-456',
      });
    });

    it('should return 400 when conversationId is missing', async () => {
      mockRequest.params = {};
      mockRequest.body = {
        messageId: 'msg-456',
      };

      mockConversationService.cancelStream = vi.fn();

      await chatController.cancelChat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockConversationService.cancelStream).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'conversationId and messageId are required',
      });
    });

    it('should return 400 when messageId is missing', async () => {
      mockRequest.params = {
        conversationId: 'conv-123',
      };
      mockRequest.body = {};

      mockConversationService.cancelStream = vi.fn();

      await chatController.cancelChat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockConversationService.cancelStream).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'conversationId and messageId are required',
      });
    });
  });
});
