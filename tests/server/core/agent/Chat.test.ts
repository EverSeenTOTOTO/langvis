import { vi, describe, it, expect, beforeEach } from 'vitest';
import ChatAgent from '@/server/core/agent/Chat';
import { ToolIds } from '@/shared/constants';

const mockLlmCallTool = {
  call: vi.fn(),
  streamCall: vi.fn(),
};

vi.mock('tsyringe', async () => {
  const actual = await vi.importActual('tsyringe');
  return {
    ...actual,
    container: {
      resolve: vi.fn((token: any) => {
        if (token === ToolIds.LLM_CALL) {
          return mockLlmCallTool;
        }
        return new (class MockLogger {
          info = vi.fn();
          error = vi.fn();
          warn = vi.fn();
          debug = vi.fn();
        })();
      }),
    },
  };
});

describe('ChatAgent', () => {
  let chatAgent: ChatAgent;

  beforeEach(() => {
    chatAgent = new ChatAgent();
    Object.defineProperty(chatAgent, 'logger', {
      value: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    vi.clearAllMocks();
  });

  it('should pass signal to llmCallTool.streamCall', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const writer = {
      write: vi.fn(),
      close: vi.fn(),
    } as any;
    const signal = new AbortController().signal;

    await chatAgent.streamCall(memory, writer, {}, signal);

    expect(mockLlmCallTool.streamCall).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      signal,
    );
  });
});
