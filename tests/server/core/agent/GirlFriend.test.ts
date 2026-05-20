import GirlFriendAgent from '@/server/core/agent/GirlFriend';
import { ToolIds } from '@/shared/constants';
import type { LlmService } from '@/server/service/LlmService';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, withTraceContext } from '../../helpers/context';

const mockTtsTool = {
  call: vi.fn(),
};

vi.mock('tsyringe', async () => {
  const actual = await vi.importActual('tsyringe');
  return {
    ...actual,
    container: {
      resolve: vi.fn((token: any) => {
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
  let mockLlmService: LlmService;

  beforeEach(() => {
    mockLlmService = {
      chat: vi.fn().mockImplementation(async function* () {
        return '';
      }),
    } as unknown as LlmService;

    girlFriendAgent = new GirlFriendAgent(mockLlmService);
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

    (mockLlmService.chat as any).mockImplementation(
      async function* (): AsyncGenerator<string, string, void> {
        yield 'Hello';
        yield ' world';
        return 'Hello world';
      },
    );

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      any,
      void
    > {
      yield ctx.agentToolResultEvent(
        'tts',
        JSON.stringify({
          voice: 'test-voice',
          filePath: 'tts/test.mp3',
        }),
      );
      return { voice: 'test-voice', filePath: 'tts/test.mp3' };
    });

    const events = await withTraceContext(async () => {
      return collectEvents(girlFriendAgent.call(memory, ctx, {}));
    });

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

  it('should pass options to llmService.chat and tts.call', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const ctx = createMockContext();

    mockTtsTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      any,
      void
    > {
      yield ctx.agentToolResultEvent('tts', '{}');
      return {};
    });

    await withTraceContext(() =>
      collectEvents(girlFriendAgent.call(memory, ctx, {})),
    );

    expect(mockLlmService.chat).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ messages: [] }),
      ctx.signal,
      expect.anything(),
    );
    expect(mockTtsTool.call).toHaveBeenCalledWith(expect.any(Object), ctx);
  });
});
