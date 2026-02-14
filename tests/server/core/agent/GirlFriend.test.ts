import GirlFriendAgent from '@/server/core/agent/GirlFriend';
import { ExecutionContext } from '@/server/core/context';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolEvent } from '@/shared/types';
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

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
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

  it('should yield tool progress events and final event', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      string,
      void
    > {
      yield ctx.toolEvent({
        type: 'progress',
        toolName: 'llm-call',
        data: 'Hello',
      });
      yield ctx.toolEvent({
        type: 'progress',
        toolName: 'llm-call',
        data: ' world',
      });
      yield ctx.toolEvent({
        type: 'result',
        toolName: 'llm-call',
        output: 'Hello world',
      });
      return 'Hello world';
    });

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      any,
      void
    > {
      yield ctx.toolEvent({
        type: 'result',
        toolName: 'tts',
        output: JSON.stringify({
          voice: 'test-voice',
          filePath: 'tts/test.mp3',
        }),
      });
      return { voice: 'test-voice', filePath: 'tts/test.mp3' };
    });

    const events = await collectEvents(girlFriendAgent.call(memory, ctx, {}));

    expect(events[0]).toMatchObject({
      type: 'tool_progress',
      data: 'Hello',
    });
    expect(events[1]).toMatchObject({
      type: 'tool_progress',
      data: ' world',
    });
    expect(events[events.length - 1]).toMatchObject({
      type: 'final',
    });
  });

  it('should pass context to llmCallTool.call and tts.call', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      string,
      void
    > {
      yield ctx.toolEvent({ type: 'result', toolName: 'llm-call', output: '' });
      return '';
    });

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      any,
      void
    > {
      yield ctx.toolEvent({ type: 'result', toolName: 'tts', output: '{}' });
      return {};
    });

    await collectEvents(girlFriendAgent.call(memory, ctx, {}));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
    expect(mockTtsTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
  });
});
