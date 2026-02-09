import GirlFriendAgent from '@/server/core/agent/GirlFriend';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLlmCallTool = {
  call: vi.fn(),
};

const mockTtsTool = {
  call: vi.fn(),
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

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, void, void>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

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
    Object.defineProperty(girlFriendAgent, 'id', {
      value: 'girlfriend',
    });
    vi.clearAllMocks();
  });

  it('should yield start, delta, meta (tts result), and end events', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const signal = new AbortController().signal;

    mockLlmCallTool.call.mockImplementation(async function* () {
      yield { type: 'delta', data: 'Hello' };
      yield { type: 'delta', data: ' world' };
      yield { type: 'result', result: 'Hello world' };
    });

    mockTtsTool.call.mockImplementation(async function* () {
      yield {
        type: 'result',
        result: { voice: 'test-voice', filePath: 'tts/test.mp3' },
      };
    });

    const events = await collectEvents(
      girlFriendAgent.call(memory, {}, signal),
    );

    expect(events[0]).toEqual({ type: 'start', agentId: 'girlfriend' });
    expect(events[1]).toEqual({ type: 'delta', content: 'Hello' });
    expect(events[2]).toEqual({ type: 'delta', content: ' world' });
    expect(events[3]).toEqual({
      type: 'meta',
      meta: { voice: 'test-voice', filePath: 'tts/test.mp3' },
    });
    expect(events[4]).toEqual({ type: 'end', agentId: 'girlfriend' });
  });

  it('should pass signal to llmCallTool.call and tts.call', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const signal = new AbortController().signal;

    mockLlmCallTool.call.mockImplementation(async function* () {
      yield { type: 'result', result: '' };
    });

    mockTtsTool.call.mockImplementation(async function* () {
      yield { type: 'result', result: {} };
    });

    await collectEvents(girlFriendAgent.call(memory, {}, signal));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(
      expect.any(Object),
      signal,
    );
    expect(mockTtsTool.call).toHaveBeenCalledWith(expect.any(Object), signal);
  });
});
