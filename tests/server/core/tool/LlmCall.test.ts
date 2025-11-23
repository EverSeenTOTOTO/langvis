import LlmCallTool from '@/server/core/tool/LlmCall';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming.mjs';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe('LlmCallTool', () => {
  let llmCallTool: LlmCallTool;
  let mockOpenAI: OpenAI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenAI = new OpenAI({ apiKey: 'test-key' });
    llmCallTool = new LlmCallTool(mockOpenAI);
  });

  describe('call', () => {
    it('should call OpenAI chat completions API with correct parameters', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: 'Test response',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockCreate.mockResolvedValue(mockResponse);

      const input: Partial<ChatCompletionCreateParamsNonStreaming> = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-3.5-turbo',
      };

      const result = await llmCallTool.call(input);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('streamCall', () => {
    it('should stream response and write to outputStream', async () => {
      // Mock the stream chunks
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
        { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
        { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      // Create mock outputStream
      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
      };

      const input: Partial<ChatCompletionCreateParamsStreaming> = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-3.5-turbo',
      };

      await llmCallTool.streamCall(input, mockOutputStream as any);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      expect(mockWriter.write).toHaveBeenCalledWith('Hello');
      expect(mockWriter.write).toHaveBeenCalledWith(' world');
      expect(mockWriter.write).toHaveBeenCalledWith('!');
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should abort writer on error', async () => {
      const mockError = new Error('Test error');

      // Mock the stream to throw an error
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          throw mockError;
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
      };

      const input: Partial<ChatCompletionCreateParamsStreaming> = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await expect(
        llmCallTool.streamCall(input, mockOutputStream as any),
      ).rejects.toThrow(mockError);

      expect(mockWriter.abort).toHaveBeenCalledWith(mockError);
    });
  });
});
