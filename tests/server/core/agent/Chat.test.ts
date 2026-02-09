import ChatAgent from '@/server/core/agent/Chat';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLlmCallTool = {
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
    Object.defineProperty(chatAgent, 'id', {
      value: 'chat',
    });
    vi.clearAllMocks();
  });

  it('should yield start, delta, and end events', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const signal = new AbortController().signal;

    mockLlmCallTool.call.mockImplementation(async function* () {
      yield { type: 'delta', data: 'Hello' };
      yield { type: 'delta', data: ' world' };
      yield { type: 'result', result: 'Hello world' };
    });

    const events = await collectEvents(chatAgent.call(memory, {}, signal));

    expect(events[0]).toEqual({ type: 'start', agentId: 'chat' });
    expect(events[1]).toEqual({ type: 'delta', content: 'Hello' });
    expect(events[2]).toEqual({ type: 'delta', content: ' world' });
    expect(events[3]).toEqual({ type: 'end', agentId: 'chat' });
  });

  it('should pass signal to llmCallTool.call', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const signal = new AbortController().signal;

    mockLlmCallTool.call.mockImplementation(async function* () {
      yield { type: 'result', result: '' };
    });

    await collectEvents(chatAgent.call(memory, {}, signal));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(
      expect.any(Object),
      signal,
    );
  });
});
