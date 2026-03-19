import LlmCallTool, { LlmCallOutput } from '@/server/core/tool/LlmCall';
import logger from '@/server/utils/logger';
import { AgentEvent } from '@/shared/types';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming.mjs';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, withTraceContext } from '../../helpers/context';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

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

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, LlmCallOutput, void>,
): Promise<{ progress: string[]; result: string }> {
  const progress: string[] = [];
  let result = '';

  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value ?? '';
      break;
    }
    if (value.type === 'tool_progress' && typeof value.data === 'string') {
      progress.push(value.data);
    }
  }

  return { progress, result };
}

describe('LlmCallTool', () => {
  let llmCallTool: LlmCallTool;
  let mockOpenAI: OpenAI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenAI = new OpenAI({ apiKey: 'test-key' });
    llmCallTool = new LlmCallTool(mockOpenAI);
    (llmCallTool as any).logger = logger;
  });

  describe('call', () => {
    it('should stream response and yield progress events', async () => {
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

      const input: Partial<ChatCompletionCreateParamsStreaming> = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-3.5-turbo',
      };

      const ctx = createMockContext();
      const { progress, result } = await withTraceContext(async () => {
        return collectEvents(llmCallTool.call(input, ctx));
      });

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
        { signal: ctx.signal },
      );

      expect(progress).toEqual(['Hello', ' world', '!']);
      expect(result).toBe('Hello world!');
    });

    it('should throw error on stream failure', async () => {
      const mockError = new Error('Test error');

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          throw mockError;
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const input: Partial<ChatCompletionCreateParamsStreaming> = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const ctx = createMockContext();
      await expect(
        withTraceContext(() => collectEvents(llmCallTool.call(input, ctx))),
      ).rejects.toThrow(mockError);
    });

    it('should return error when content_filter is triggered', async () => {
      const mockChunks = [
        {
          choices: [
            { delta: { content: '{"final_answer' }, finish_reason: null },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'content_filter' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const ctx = createMockContext();
      const events: AgentEvent[] = [];

      await withTraceContext(async () => {
        try {
          for await (const event of llmCallTool.call(
            { messages: [{ role: 'user', content: 'test' }] },
            ctx,
          )) {
            events.push(event);
          }
        } catch (_e) {
          // Tool throws error for content_filter
        }
      });

      expect(events.some(e => e.type === 'error')).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Content filter triggered'),
      );
    });

    it('should warn when length limit is reached', async () => {
      const mockChunks = [
        {
          choices: [
            { delta: { content: 'Partial response' }, finish_reason: null },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const ctx = createMockContext();
      const { result } = await withTraceContext(async () => {
        return collectEvents(
          llmCallTool.call(
            { messages: [{ role: 'user', content: 'test' }] },
            ctx,
          ),
        );
      });

      expect(result).toBe('Partial response');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('max_tokens limit reached'),
      );
    });

    it('should convert messages with image attachments to multimodal format', async () => {
      const mockChunks = [
        {
          choices: [
            { delta: { content: 'I see an image' }, finish_reason: null },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const input = {
        messages: [
          {
            role: 'user' as const,
            content: 'What is in this image?',
            attachments: [
              {
                filename: 'test.png',
                url: 'https://example.com/test.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          },
        ],
        model: 'gpt-4o',
      };

      const ctx = createMockContext();
      await withTraceContext(() => collectEvents(llmCallTool.call(input, ctx)));

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          stream: true,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image?' },
                {
                  type: 'image_url',
                  image_url: { url: 'https://example.com/test.png' },
                },
              ],
            },
          ],
        }),
        { signal: ctx.signal },
      );
    });

    it('should handle messages with multiple image attachments', async () => {
      const mockChunks = [
        {
          choices: [{ delta: { content: 'Response' }, finish_reason: null }],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const input = {
        messages: [
          {
            role: 'user' as const,
            content: 'Compare these images',
            attachments: [
              {
                filename: 'image1.png',
                url: 'https://example.com/image1.png',
                mimeType: 'image/png',
                size: 1024,
              },
              {
                filename: 'image2.jpg',
                url: 'https://example.com/image2.jpg',
                mimeType: 'image/jpeg',
                size: 2048,
              },
            ],
          },
        ],
        model: 'gpt-4o',
      };

      const ctx = createMockContext();
      await withTraceContext(() => collectEvents(llmCallTool.call(input, ctx)));

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[0];

      expect(userMessage.content).toHaveLength(3);
      expect(userMessage.content[0]).toEqual({
        type: 'text',
        text: 'Compare these images',
      });
      expect(userMessage.content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/image1.png' },
      });
      expect(userMessage.content[2]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/image2.jpg' },
      });
    });

    it('should not convert non-image attachments to multimodal format', async () => {
      const mockChunks = [
        {
          choices: [{ delta: { content: 'Response' }, finish_reason: null }],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const input = {
        messages: [
          {
            role: 'user' as const,
            content: 'Read this PDF',
            attachments: [
              {
                filename: 'document.pdf',
                url: 'https://example.com/document.pdf',
                mimeType: 'application/pdf',
                size: 10240,
              },
            ],
          },
        ],
        model: 'gpt-4o',
      };

      const ctx = createMockContext();
      await withTraceContext(() => collectEvents(llmCallTool.call(input, ctx)));

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[0];

      expect(userMessage.content).toEqual([
        { type: 'text', text: 'Read this PDF' },
      ]);
    });

    it('should not convert assistant messages to multimodal format', async () => {
      const mockChunks = [
        {
          choices: [{ delta: { content: 'Response' }, finish_reason: null }],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      } as unknown as Stream<any>;

      mockCreate.mockResolvedValue(mockStream);

      const input = {
        messages: [
          {
            role: 'user' as const,
            content: 'Hello',
          },
          {
            role: 'assistant' as const,
            content: 'Hi there!',
            attachments: [
              {
                filename: 'image.png',
                url: 'https://example.com/image.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          },
        ],
        model: 'gpt-4o',
      };

      const ctx = createMockContext();
      await withTraceContext(() => collectEvents(llmCallTool.call(input, ctx)));

      const callArgs = mockCreate.mock.calls[0][0];

      expect(callArgs.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hi there!',
      });
    });
  });
});
