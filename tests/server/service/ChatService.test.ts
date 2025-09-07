import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '../../../src/server/service/ChatService';
import { SSEMessage } from '../../../src/shared/types';

describe('ChatService', () => {
  let chatService: ChatService;

  beforeEach(() => {
    chatService = new ChatService();
    vi.clearAllMocks();
  });

  describe('initSSEConnection', () => {
    it('should initialize an SSE connection', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = {
        writeHead: vi.fn(),
        write: vi.fn(),
        flush: vi.fn(),
      };

      const connection = chatService.initSSEConnection(
        conversationId,
        mockResponse,
      );

      expect(connection.conversationId).toBe(conversationId);
      expect(connection.response).toBe(mockResponse);
      expect(connection.createdAt).toBeInstanceOf(Date);
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      expect(mockResponse.write).toHaveBeenCalledWith(
        `data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`,
      );
    });
  });

  describe('closeSSEConnection', () => {
    it('should close an SSE connection', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = {
        writeHead: vi.fn(),
        write: vi.fn(),
        flush: vi.fn(),
        end: vi.fn(),
        writableEnded: false,
      };

      chatService.initSSEConnection(conversationId, mockResponse);
      chatService.closeSSEConnection(conversationId);

      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('sendToConversation', () => {
    it('should send data to all connections for a conversation', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = {
        writeHead: vi.fn(),
        write: vi.fn(() => true),
        flush: vi.fn(),
        writableEnded: false,
      };

      // Initialize connection
      chatService.initSSEConnection(conversationId, mockResponse);

      // Clear the initial "connected" message call
      mockResponse.write.mockClear();

      const testData: SSEMessage = {
        type: 'reply',
        content: 'Test message',
      };
      chatService.sendToConversation(conversationId, testData);

      // Verify the call with specific arguments
      expect(mockResponse.write).toHaveBeenCalledWith(
        `data: ${JSON.stringify(testData)}\n\n`,
      );
    });
  });
});
