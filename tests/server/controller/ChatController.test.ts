import ChatController from '@/server/controller/ChatController';
import { TraceContext } from '@/server/core/TraceContext';
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

class MockConversationService {
  getConversationById = vi.fn();
  batchAddMessages = vi.fn();
  updateMessage = vi.fn();
}

class MockChatService {
  acquireSession = vi.fn();
  getSession = vi.fn();
  runSession = vi.fn();
  buildMemory = vi.fn();
  getSessionState = vi.fn();
}

class MockAuthService {
  getUserId = vi.fn();
}

let mockConversationService: MockConversationService;
let mockChatService: MockChatService;
let mockAuthService: MockAuthService;

describe('ChatController', () => {
  let chatController: ChatController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConversationService = new MockConversationService();
    mockChatService = new MockChatService();
    mockAuthService = new MockAuthService();

    chatController = new ChatController(
      mockConversationService as any,
      mockChatService as any,
      mockAuthService as any,
    );

    mockJson = vi.fn(() => mockResponse as Response);
    mockStatus = vi.fn(() => ({ json: mockJson }) as any);

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      sendStatus: vi.fn(),
      writeHead: vi.fn().mockReturnThis(),
      write: vi.fn().mockReturnValue(true),
      flush: vi.fn(),
      writableEnded: false,
      end: vi.fn(),
      writable: true,
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
    it('should return 204 if phase is done', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockChatService.getSessionState.mockResolvedValue({ phase: 'done' });

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.sendStatus).toHaveBeenCalledWith(204);
    });

    it('should return 204 if acquireSession returns null', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockChatService.getSessionState.mockResolvedValue({ phase: 'waiting' });
      mockChatService.acquireSession.mockResolvedValue(null);

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockResponse.sendStatus).toHaveBeenCalledWith(204);
    });

    it('should create session and bind SSE connection', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockChatService.getSessionState.mockResolvedValue({ phase: 'waiting' });

      const mockSession = {
        bindConnection: vi.fn(),
        handleDisconnect: vi.fn(),
      };
      mockChatService.acquireSession.mockResolvedValue(mockSession);

      await chatController.initSSE(
        'conv-123',
        mockRequest as Request,
        mockResponse as Response,
      );

      // SSEConnection constructor calls writeHead
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      expect(mockSession.bindConnection).toHaveBeenCalled();
      expect(mockRequest.on).toHaveBeenCalledWith(
        'close',
        expect.any(Function),
      );
    });

    it('should call handleDisconnect on close event', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockChatService.getSessionState.mockResolvedValue({ phase: 'waiting' });

      const mockSession = {
        bindConnection: vi.fn(),
        handleDisconnect: vi.fn(),
      };
      mockChatService.acquireSession.mockResolvedValue(mockSession);

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

      expect(mockSession.handleDisconnect).toHaveBeenCalled();
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
      await TraceContext.run(
        { requestId: 'test-req', userId: 'user-123' },
        async () => {
          mockRequest.params = { conversationId: 'conv-123' };
          mockRequest.body = { role: Role.USER, content: 'Hello' };

          const mockSession = {
            phase: 'waiting',
            addMessageFSM: vi.fn(),
          };
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

          mockAuthService.getUserId.mockResolvedValue('user-123');

          const mockMemory = {};
          mockChatService.buildMemory.mockResolvedValue(mockMemory);

          mockConversationService.batchAddMessages.mockResolvedValue([
            { id: 'assistant-msg', role: Role.ASSIST, content: '' },
          ]);

          await chatController.chat(
            'conv-123',
            { conversationId: 'conv-123', role: Role.USER, content: 'Hello' },
            mockRequest as Request,
            mockResponse as Response,
          );

          expect(mockAuthService.getUserId).toHaveBeenCalledWith(mockRequest);
          expect(mockChatService.buildMemory).toHaveBeenCalledWith(
            mockAgent,
            mockConversation.config,
            { role: Role.USER, content: 'Hello', attachments: undefined },
          );
          expect(mockConversationService.batchAddMessages).toHaveBeenCalledWith(
            'conv-123',
            [expect.objectContaining({ role: Role.ASSIST, content: '' })],
          );

          expect(mockStatus).toHaveBeenCalledWith(200);
          expect(mockJson).toHaveBeenCalledWith({
            success: true,
            messageId: 'assistant-msg',
          });

          expect(mockSession.addMessageFSM).toHaveBeenCalled();
          expect(mockChatService.runSession).toHaveBeenCalled();
        },
      );
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

    it('should return 404 if session not active or waiting', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123' };

      const mockSession = { phase: 'done' };
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
        phase: 'active',
        cancelAllMessages: vi.fn(),
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

      expect(mockSession.cancelAllMessages).toHaveBeenCalledWith(
        'User cancelled',
      );
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ success: true });
    });

    it('should use default reason if not provided', async () => {
      mockRequest.params = { conversationId: 'conv-123' };
      mockRequest.body = { messageId: 'msg-123' };

      const mockSession = {
        phase: 'active',
        cancelAllMessages: vi.fn(),
      };
      mockChatService.getSession.mockReturnValue(mockSession);

      await chatController.cancelChat(
        'conv-123',
        { conversationId: 'conv-123', messageId: 'msg-123' },
        mockRequest as Request,
        mockResponse as Response,
      );

      expect(mockSession.cancelAllMessages).toHaveBeenCalledWith(
        'Cancelled by user',
      );
    });
  });
});
