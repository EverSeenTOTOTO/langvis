import LlmCallTool, { LlmCallOutput } from '@/server/core/tool/LlmCall';
import type { LlmService } from '@/server/service/LlmService';
import logger from '@/server/utils/logger';
import { AgentEvent } from '@/shared/types';
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

function createMockProgressEvents(texts: string[]): AgentEvent[] {
  return texts.map(t => ({
    type: 'tool_progress' as const,
    messageId: '',
    callId: '',
    toolName: 'llm_call',
    data: t,
    seq: 0,
    at: Date.now(),
  }));
}

function createMockLlmService(
  events: AgentEvent[],
  result: string,
): LlmService {
  return {
    chat: vi.fn().mockImplementation(function* () {
      for (const event of events) yield event;
      return result;
    }),
  } as unknown as LlmService;
}

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('call', () => {
    it('should delegate to LlmService.chat and stream progress events', async () => {
      const events = createMockProgressEvents(['Hello', ' world', '!']);
      const mockLlmService = createMockLlmService(events, 'Hello world!');

      llmCallTool = new LlmCallTool(mockLlmService);
      (llmCallTool as any).logger = logger;

      const ctx = createMockContext();
      const { progress, result } = await withTraceContext(async () => {
        return collectEvents(
          llmCallTool.call(
            {
              modelId: 'openrouter:gpt-4o',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            ctx,
          ),
        );
      });

      expect(mockLlmService.chat).toHaveBeenCalledWith(
        'openrouter:gpt-4o',
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
        ctx.signal,
        logger,
      );

      expect(progress).toEqual(['Hello', ' world', '!']);
      expect(result).toBe('Hello world!');
    });

    it('should pass temperature and topP to LlmService', async () => {
      const events = createMockProgressEvents(['Response']);
      const mockLlmService = createMockLlmService(events, 'Response');

      llmCallTool = new LlmCallTool(mockLlmService);
      (llmCallTool as any).logger = logger;

      const ctx = createMockContext();
      await withTraceContext(async () => {
        return collectEvents(
          llmCallTool.call(
            {
              modelId: 'openrouter:gpt-4o',
              temperature: 0.5,
              topP: 0.9,
              messages: [{ role: 'user', content: 'test' }],
            },
            ctx,
          ),
        );
      });

      expect(mockLlmService.chat).toHaveBeenCalledWith(
        'openrouter:gpt-4o',
        expect.objectContaining({
          temperature: 0.5,
          top_p: 0.9,
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should propagate errors from LlmService', async () => {
      const mockLlmService = {
        chat: vi.fn().mockImplementation(function* () {
          throw new Error('API rate limit exceeded');
        }),
      } as unknown as LlmService;

      llmCallTool = new LlmCallTool(mockLlmService);
      (llmCallTool as any).logger = logger;

      const ctx = createMockContext();
      await expect(
        withTraceContext(() =>
          collectEvents(
            llmCallTool.call(
              {
                modelId: 'openrouter:gpt-4o',
                messages: [{ role: 'user', content: 'test' }],
              },
              ctx,
            ),
          ),
        ),
      ).rejects.toThrow('API rate limit exceeded');
    });
  });
});
