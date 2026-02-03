import { vi, describe, it, expect, beforeEach } from 'vitest';
import GirlFriendAgent from '@/server/core/agent/GirlFriend';
import { ToolIds } from '@/shared/constants';

const mockLlmCallTool = {
  call: vi.fn(),
  streamCall: vi.fn(),
};

const mockTtsTool = {
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
        if (token === ToolIds.TEXT_TO_SPEECH) {
          return mockTtsTool;
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

describe('GirlFriendAgent', () => {
  let girlFriendAgent: GirlFriendAgent;

  beforeEach(() => {
    girlFriendAgent = new GirlFriendAgent();
    Object.defineProperty(girlFriendAgent, 'logger', {
      value: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    vi.clearAllMocks();
  });

  it('should pass signal to llmCallTool.streamCall and tts.call', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const writer = {
      write: vi.fn(),
      close: vi.fn(),
    } as any;
    const signal = new AbortController().signal;

    // To mock the close event of the WritableStream
    mockLlmCallTool.streamCall.mockImplementation(async (_options, _writer) => {
      await _writer.close();
    });

    await girlFriendAgent.streamCall(memory, writer, {}, signal);

    expect(mockLlmCallTool.streamCall).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      signal,
    );
    expect(mockTtsTool.call).toHaveBeenCalledWith(expect.any(Object), signal);
  });
});
