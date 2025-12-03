import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEService } from '@/server/service/SSEService';
import { SSEMessage } from '@/shared/types';
import type { Response } from 'express';

// Helper to create a proper mock Response object
const createMockResponse = (): Response => {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    flush: vi.fn(),
    end: vi.fn(),
    writable: true,
    writableEnded: false,
  } as any as Response;
};

describe('ChatService', () => {
  let chatService: SSEService;

  beforeEach(() => {
    chatService = new SSEService();
    vi.clearAllMocks();
  });

  describe('initSSEConnection', () => {
    it('should initialize an SSE connection', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = createMockResponse();

      const connection = chatService.initSSEConnection(
        conversationId,
        mockResponse,
      );

      expect(connection.conversationId).toBe(conversationId);
      expect(connection.response).toBe(mockResponse);
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
      const mockResponse = createMockResponse();

      chatService.initSSEConnection(conversationId, mockResponse);
      chatService.closeSSEConnection(conversationId);

      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('sendToConversation', () => {
    it('should send data to all connections for a conversation', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = createMockResponse();

      // Initialize connection
      chatService.initSSEConnection(conversationId, mockResponse);

      // Clear the initial "connected" message call
      (mockResponse.write as any).mockClear();

      const testData: SSEMessage = {
        type: 'completion_delta',
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
