import { Role } from '@/shared/types/entities';
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
  return ExecutionContext.create(
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

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      any,
      void
    > {
      yield ctx.toolResultEvent(
        'tts',
        JSON.stringify({
          voice: 'test-voice',
          filePath: 'tts/test.mp3',
        }),
      );
      return { voice: 'test-voice', filePath: 'tts/test.mp3' };
    });

    const events = await collectEvents(girlFriendAgent.call(memory, ctx, {}));

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
      yield ctx.toolResultEvent('llm-call', '');
      return '';
    });

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      ToolEvent,
      any,
      void
    > {
      yield ctx.toolResultEvent('tts', '{}');
      return {};
    });

    await collectEvents(girlFriendAgent.call(memory, ctx, {}));

    expect(mockLlmCallTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
    expect(mockTtsTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
  });
});
