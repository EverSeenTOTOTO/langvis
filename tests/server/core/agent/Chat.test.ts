import ChatAgent from '@/server/core/agent/Chat';
import type { LlmService } from '@/server/service/LlmService';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

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
  let mockLlmService: LlmService;

  beforeEach(() => {
    mockLlmService = {
      chat: vi.fn().mockImplementation(async function* () {
        return '';
      }),
    } as unknown as LlmService;

    chatAgent = new ChatAgent(mockLlmService);
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

    (mockLlmService.chat as any).mockImplementation(
      async function* (): AsyncGenerator<string, string, void> {
        yield 'Hello';
        yield ' world';
        return 'Hello world';
      },
    );

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
    expect(events[events.length - 1]).toMatchObject({
      type: 'final',
    });
  });

  it('should pass options to llmService.chat', async () => {
    const memory = {
      summarize: vi.fn().mockResolvedValue([]),
    } as any;
    const ctx = createMockContext();

    await collectEvents(chatAgent.call(memory, ctx, {}));

    expect(mockLlmService.chat).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        messages: [],
      }),
      ctx.signal,
      expect.anything(),
    );
  });
});
