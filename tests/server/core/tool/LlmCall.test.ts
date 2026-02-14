import LlmCallTool, { LlmCallOutput } from '@/server/core/tool/LlmCall';
import { ExecutionContext } from '@/server/core/context';
import { ToolEvent } from '@/shared/types';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming.mjs';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
}

async function collectEvents(
  generator: AsyncGenerator<ToolEvent, LlmCallOutput, void>,
): Promise<{ progress: string[]; result: string }> {
  const progress: string[] = [];
  let result = '';
  for await (const event of generator) {
    if (event.type === 'progress' && typeof event.data === 'string') {
      progress.push(event.data);
    } else if (event.type === 'result') {
      result = event.output;
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
      const { progress, result } = await collectEvents(
        llmCallTool.call(input, ctx),
      );

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
      await expect(collectEvents(llmCallTool.call(input, ctx))).rejects.toThrow(
        mockError,
      );
    });
  });
});
