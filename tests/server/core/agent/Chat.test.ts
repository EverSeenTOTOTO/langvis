import ChatAgent from '@/server/core/agent/Chat';
import { ExecutionContext } from '@/server/core/context';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolEvent } from '@/shared/types';
import { Role } from '@/shared/types/entities';
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
  return new ExecutionContext(
    {
      id: 'test-trace-id',
      role: Role.ASSIST,
      content: '',
      conversationId: 'test-conversation',
      createdAt: new Date(),
    },
    new AbortController(),
  );
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

  it('should yield stream events and final event', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      string,
      void
    > {
      yield ctx.toolProgressEvent('llm-call', 'Hello');
      yield ctx.toolProgressEvent('llm-call', ' world');
      yield ctx.toolResultEvent('llm-call', 'Hello world');
      return 'Hello world';
    });

    const events = await collectEvents(chatAgent.call(memory, ctx, {}));

    expect(events[0]).toMatchObject({
      type: 'start',
    });
    expect(events[1]).toMatchObject({
      type: 'stream',
      content: 'Hello',
    });
    expect(events[2]).toMatchObject({
      type: 'stream',
      content: ' world',
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
      yield ctx.toolResultEvent('llm-call', '');
      return '';
    });

    await collectEvents(chatAgent.call(memory, ctx, {}));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
  });
});
