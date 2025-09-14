import { describe, it, beforeEach, vi, expect } from 'vitest';
import { ChatController } from '@/server/controller/ChatController';
import type { Request, Response } from 'express';
import { Role } from '@/shared/entities/Message';

// Create mock service classes
class MockChatService {
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
}

class MockCompletionService {
  streamChatCompletion = vi.fn().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] };
      yield {
        choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
      };
    },
  });

  streamAgentCall = vi.fn().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] };
      yield {
        choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
      };
    },
  });
}

let mockChatService: MockChatService;
let mockConversationService: MockConversationService;
let mockCompletionService: MockCompletionService;

describe('ChatController', () => {
  let chatController: ChatController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockWriteHead: ReturnType<typeof vi.fn>;
  let mockWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockChatService = new MockChatService();
    mockConversationService = new MockConversationService();
    mockCompletionService = new MockCompletionService();
    chatController = new ChatController(
      mockChatService as any,
      mockConversationService as any,
      mockCompletionService as any,
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

      mockChatService.initSSEConnection = vi
        .fn()
        .mockReturnValue('connection-id');

      await chatController.initSSE(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockChatService.initSSEConnection).toHaveBeenCalledWith(
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
  });

  describe('chat', () => {
    it('should add a message to conversation and start completion', async () => {
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

      mockConversationService.getMessagesByConversationId = vi
        .fn()
        .mockResolvedValue([{ role: Role.USER, content: 'Hello' }]);

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(
        mockConversationService.addMessageToConversation,
      ).toHaveBeenCalledWith(conversationId, role, content);
      expect(mockStatus).toHaveBeenCalledWith(201);
      expect(mockJson).toHaveBeenCalledWith(mockMessage);
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

      expect(mockConversationService.getConversationById).toHaveBeenCalledWith(
        conversationId,
      );
    });
  });

  describe('startAgent', () => {
    it('should create and update message during agent streaming', async () => {
      const conversationId = 'test-conversation-id';
      const mockMessage = {
        id: '1',
        conversationId,
        role: Role.ASSIST,
        content: '',
      };

      mockRequest.params = { conversationId };

      // Mock conversation service methods
      mockConversationService.getMessagesByConversationId = vi
        .fn()
        .mockResolvedValue([{ role: Role.USER, content: 'Hello' }]);

      mockConversationService.addMessageToConversation = vi
        .fn()
        .mockResolvedValue(mockMessage);

      mockConversationService.updateMessage = vi
        .fn()
        .mockResolvedValue({ ...mockMessage, content: 'Hello world' });

      // Track calls to streamAgentCall
      let capturedOutputStream: any = null;

      // Mock completion service
      mockCompletionService.streamAgentCall = vi
        .fn()
        .mockImplementation(async params => {
          const { outputStream } = params;
          capturedOutputStream = outputStream;
        });

      // Call startAgent directly
      const startAgentPromise = (chatController as any).startAgent(
        mockRequest as Request,
        { agent: 'test-agent' },
      );

      // Wait for streamAgentCall to be called
      await vi.waitFor(() => {
        expect(mockCompletionService.streamAgentCall).toHaveBeenCalled();
      });

      // Now manually call the write and close methods on the captured output stream
      if (capturedOutputStream) {
        const writer = capturedOutputStream.getWriter();
        await writer.write('Hello');
        await writer.write(' world');
        await writer.close();
      }

      // Wait for startAgent to complete
      await startAgentPromise;

      // Verify interactions
      expect(
        mockConversationService.addMessageToConversation,
      ).toHaveBeenCalledWith(conversationId, Role.ASSIST, '');

      expect(mockConversationService.updateMessage).toHaveBeenCalledWith(
        '1',
        'Hello',
      );

      expect(mockConversationService.updateMessage).toHaveBeenCalledWith(
        '1',
        'Hello world',
      );

      expect(mockChatService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_delta', content: 'Hello' },
      );

      expect(mockChatService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_delta', content: ' world' },
      );

      expect(mockChatService.sendToConversation).toHaveBeenCalledWith(
        conversationId,
        { type: 'completion_done' },
      );
    });
  });
});
