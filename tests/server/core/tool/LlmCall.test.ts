import LlmCallTool, { LlmCallOutput } from '@/server/core/tool/LlmCall';
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

async function collectEvents(
  generator: AsyncGenerator<ToolEvent<LlmCallOutput>, LlmCallOutput, void>,
): Promise<{ deltas: string[]; result: string }> {
  const deltas: string[] = [];
  let result = '';
  for await (const event of generator) {
    if (event.type === 'delta') {
      deltas.push(event.data);
    } else if (event.type === 'result') {
      result = event.result;
    }
  }
  return { deltas, result };
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
    it('should stream response and yield delta events', async () => {
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

      const { deltas, result } = await collectEvents(llmCallTool.call(input));

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
        { signal: undefined },
      );

      expect(deltas).toEqual(['Hello', ' world', '!']);
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

      await expect(collectEvents(llmCallTool.call(input))).rejects.toThrow(
        mockError,
      );
    });
  });
});
