import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEService } from '@/server/service/SSEService';
import { AgentEvent } from '@/shared/types';
import type { Response } from 'express';

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

describe('SSEService', () => {
  let sseService: SSEService;

  beforeEach(() => {
    sseService = new SSEService();
    vi.clearAllMocks();
  });

  describe('initSSEConnection', () => {
    it('should initialize an SSE connection', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = createMockResponse();

      const connection = sseService.initSSEConnection(
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
      expect(mockResponse.write).toHaveBeenCalledWith('\n');
    });
  });

  describe('closeSSEConnection', () => {
    it('should close an SSE connection', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = createMockResponse();

      sseService.initSSEConnection(conversationId, mockResponse);
      sseService.closeSSEConnection(conversationId);

      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('sendToConversation', () => {
    it('should send data to all connections for a conversation', () => {
      const conversationId = 'test-conversation-id';
      const mockResponse = createMockResponse();

      sseService.initSSEConnection(conversationId, mockResponse);

      (mockResponse.write as any).mockClear();

      const testData: AgentEvent = {
        type: 'stream',
        content: 'Test message',
      };
      sseService.sendToConversation(conversationId, testData);

      expect(mockResponse.write).toHaveBeenCalledWith(
        `data: ${JSON.stringify(testData)}\n\n`,
      );
    });
  });
});
