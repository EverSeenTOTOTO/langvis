import ChatAgent from '@/server/core/agent/Chat';
import { ExecutionContext } from '@/server/core/context';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolEvent } from '@/shared/types';
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

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
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

    const events = await collectEvents(chatAgent.call(memory, ctx, {}));

    expect(events[0]).toMatchObject({
      type: 'tool_progress',
      data: 'Hello',
    });
    expect(events[1]).toMatchObject({
      type: 'tool_progress',
      data: ' world',
    });
    expect(events[2]).toMatchObject({
      type: 'tool_result',
    });
    expect(events[3]).toMatchObject({
      type: 'final',
    });
  });

  it('should pass context to llmCallTool.call', async () => {
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

    await collectEvents(chatAgent.call(memory, ctx, {}));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
  });
});
