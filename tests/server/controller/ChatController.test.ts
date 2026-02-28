import ChatController from '@/server/controller/ChatController';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container } from 'tsyringe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tsyringe', () => ({
  container: {
    resolve: vi.fn(),
    register: vi.fn(),
  },
  singleton: () => vi.fn(),
  inject: () => vi.fn(),
  injectable: () => vi.fn(),
}));

class MockSSEService {
  initSSEConnection = vi.fn().mockReturnValue({
    conversationId: 'conv-123',
    response: {},
    heartbeat: null,
  });
}

class MockConversationService {
  getConversationById = vi.fn();
  batchAddMessages = vi.fn();
}

class MockChatService {
  acquireSession = vi.fn();
  getSession = vi.fn();
  startAgent = vi.fn();
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

    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };

    mockRequest = {
      params: {},
      body: {},
      on: vi.fn(),
      log: {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
    };

    vi.clearAllMocks();
  });

  describe('initSSE', () => {
    it('should return 409 if session already running', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockChatService.acquireSession.mockReturnValue(null);

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(409);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Session already running',
      });
    });

    it('should create session and bind SSE connection', async () => {
      mockRequest.params = { conversationId: 'conv-123' };

      const mockSession = {
        bindConnection: vi.fn(),
        onClientDisconnect: vi.fn(),
      };
      mockChatService.acquireSession.mockReturnValue(mockSession);

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockSSEService.initSSEConnection).toHaveBeenCalledWith(
        'conv-123',
        mockResponse,
      );
      expect(mockSession.bindConnection).toHaveBeenCalled();
      expect(mockRequest.on).toHaveBeenCalledWith(
        'close',
        expect.any(Function),
      );
    });

    it('should call onClientDisconnect on close event', async () => {
      mockRequest.params = { conversationId: 'conv-123' };

      const mockSession = {
        bindConnection: vi.fn(),
        onClientDisconnect: vi.fn(),
      };
      mockChatService.acquireSession.mockReturnValue(mockSession);

      let closeCallback: (() => void) | undefined;
      (mockRequest.on as any).mockImplementation(
        (event: string, callback: () => void) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        },
      );

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      closeCallback?.();

      expect(mockSession.onClientDisconnect).toHaveBeenCalled();
    });
  });

  describe('chat', () => {
    it('should return 400 if no session exists', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { role: Role.USER, content: 'Hello' };

      mockChatService.getSession.mockReturnValue(undefined);

      await chatController.chat(
        'conv-123',
        { conversationId: 'conv-123', role: Role.USER, content: 'Hello' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'SSE connection not established',
      });
    });

    it('should return 400 if session not in waiting phase', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { role: Role.USER, content: 'Hello' };

      const mockSession = {
        phase: 'running',
      };
      mockChatService.getSession.mockReturnValue(mockSession);

      await chatController.chat(
        'conv-123',
        { conversationId: 'conv-123', role: Role.USER, content: 'Hello' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Session already running',
      });
    });

    it('should return 400 if conversation not found', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { role: Role.USER, content: 'Hello' };

      const mockSession = { phase: 'waiting' };
      mockChatService.getSession.mockReturnValue(mockSession);
      mockConversationService.getConversationById.mockResolvedValue(null);

      await chatController.chat(
        'conv-123',
        { conversationId: 'conv-123', role: Role.USER, content: 'Hello' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Conversation conv-123 not found',
      });
    });

    it('should persist messages and start agent', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { role: Role.USER, content: 'Hello' };

      const mockSession = { phase: 'waiting' };
      mockChatService.getSession.mockReturnValue(mockSession);

      const mockConversation = {
        id: 'conv-123',
        config: { agent: 'ChatAgent' },
      };
      mockConversationService.getConversationById.mockResolvedValue(
        mockConversation,
      );

      const mockAgent = {};
      (container.resolve as any).mockReturnValue(mockAgent);

      const mockMemory = {};
      mockChatService.buildMemory.mockResolvedValue(mockMemory);

      mockConversationService.batchAddMessages.mockResolvedValue([
        { id: 'user-msg', role: Role.USER, content: 'Hello' },
        { id: 'assistant-msg', role: Role.ASSIST, content: '' },
      ]);

      await chatController.chat(
        'conv-123',
        { conversationId: 'conv-123', role: Role.USER, content: 'Hello' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
        'conv-123',
        expect.arrayContaining([
          expect.objectContaining({ role: Role.USER, content: 'Hello' }),
          expect.objectContaining({ role: Role.ASSIST, content: '' }),
        ]),
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        messageId: 'assistant-msg',
      });

      expect(mockChatService.startAgent).toHaveBeenCalled();
    });
  });

  describe('cancelChat', () => {
    it('should return 404 if no session exists', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123' };

      mockChatService.getSession.mockReturnValue(undefined);

      await chatController.cancelChat(
        'conv-123',
        { conversationId: 'conv-123', messageId: 'msg-123' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
    });

    it('should return 404 if session not running', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123' };

      const mockSession = { phase: 'waiting' };
      mockChatService.getSession.mockReturnValue(mockSession);

      await chatController.cancelChat(
        'conv-123',
        { conversationId: 'conv-123', messageId: 'msg-123' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
    });

    it('should cancel running session', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123', reason: 'User cancelled' };

      const mockSession = {
        phase: 'running',
        cancel: vi.fn(),
      };
      mockChatService.getSession.mockReturnValue(mockSession);

      await chatController.cancelChat(
        'conv-123',
        {
          conversationId: 'conv-123',
          messageId: 'msg-123',
          reason: 'User cancelled',
        },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockSession.cancel).toHaveBeenCalledWith('User cancelled');
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
    });

    it('should use default reason if not provided', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123' };

      const mockSession = {
        phase: 'running',
        cancel: vi.fn(),
      };
      mockChatService.getSession.mockReturnValue(mockSession);

      await chatController.cancelChat(
        'conv-123',
        { conversationId: 'conv-123', messageId: 'msg-123' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockSession.cancel).toHaveBeenCalledWith('Cancelled by user');
    });
  });
});
