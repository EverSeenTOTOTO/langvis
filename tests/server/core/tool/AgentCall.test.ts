import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { AgentIds, MemoryIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { TraceContext } from '@/server/core/TraceContext';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import AgentCallTool from '@/server/core/tool/AgentCall';
import type { Agent } from '@/server/core/agent';
import type { Memory } from '@/server/core/memory';
import { Prompt } from '@/server/core/PromptBuilder';

const originalResolve = container.resolve.bind(container);

function createMockAgent(
  id: string,
  events: AgentEvent[],
): { agent: Agent; instance: any } {
  const instance: any = {
    id,
    config: {
      name: id,
      description: `Mock ${id}`,
      tools: [],
    },
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    tools: [],
    get systemPrompt() {
      return Prompt.empty();
    },
    async *call() {
      for (const event of events) {
        yield event;
      }
    },
  };
  return { agent: instance as unknown as Agent, instance };
}

const mockChildMemory = {
  setContext: vi.fn(),
  summarize: vi.fn().mockResolvedValue([]),
};

function wrapTrace<T>(fn: () => Promise<T>): Promise<T> {
  return TraceContext.run(
    {
      requestId: 'test-req',
      conversationId: 'test-conv',
      messageId: 'test-msg',
    },
    fn,
  );
}

async function collectEvents<T>(
  generator: AsyncGenerator<AgentEvent, T, void>,
): Promise<{ events: AgentEvent[]; result: T }> {
  const events: AgentEvent[] = [];
  let result: T;
  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value as T;
      break;
    }
    events.push(value);
  }
  return { events, result };
}

describe('AgentCallTool', () => {
  let tool: AgentCallTool;
  let resolveSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    resolveSpy = vi
      .spyOn(container, 'resolve' as any)
      .mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        return originalResolve(token);
      });

    tool = new AgentCallTool();
    (tool as any).id = 'agent_call';
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it('should return error when agent not available', () =>
    wrapTrace(async () => {
      // Don't mock AgentIds.REACT, so container.resolve throws
      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        tool.call({ query: 'hello' }, ctx),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent not available');
    }));

  it('should execute agent and return accumulated stream content', () =>
    wrapTrace(async () => {
      const { instance } = createMockAgent(AgentIds.REACT, [
        { type: 'start', messageId: 'child-msg', seq: 1, at: Date.now() },
        {
          type: 'stream',
          messageId: 'child-msg',
          content: 'hello ',
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'stream',
          messageId: 'child-msg',
          content: 'world',
          seq: 3,
          at: Date.now(),
        },
        { type: 'final', messageId: 'child-msg', seq: 4, at: Date.now() },
      ]);

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result, events } = await collectEvents(
        tool.call(
          {
            query: 'say hello',
            context: 'some context',
          },
          ctx,
        ),
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe('hello world');
      expect(events.length).toBe(4);

      // All child events should be wrapped as tool_progress with status agent_event
      for (const event of events) {
        expect(event.type).toBe('tool_progress');
        expect((event as any).data.status).toBe('agent_event');
      }
    }));

  it('should return error when child agent emits error event', () =>
    wrapTrace(async () => {
      const { instance } = createMockAgent(AgentIds.REACT, [
        { type: 'start', messageId: 'child-msg', seq: 1, at: Date.now() },
        {
          type: 'error',
          messageId: 'child-msg',
          error: 'something went wrong',
          seq: 2,
          at: Date.now(),
        },
      ]);

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(tool.call({ query: 'fail' }, ctx));

      expect(result.success).toBe(false);
      expect(result.error).toBe('something went wrong');
    }));

  it('should return error when child agent emits cancelled event', () =>
    wrapTrace(async () => {
      const { instance } = createMockAgent(AgentIds.REACT, [
        {
          type: 'cancelled',
          messageId: 'child-msg',
          reason: 'user cancelled',
          seq: 1,
          at: Date.now(),
        },
      ]);

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        tool.call({ query: 'cancel me' }, ctx),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('user cancelled');
    }));

  it('should return error when child agent throws', () =>
    wrapTrace(async () => {
      const instance: any = {
        id: AgentIds.REACT,
        config: {
          name: 'react_agent',
          description: 'test',
          tools: [],
        },
        logger: {
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        },
        tools: [],
        get systemPrompt() {
          return Prompt.empty();
        },
        async *call() {
          throw new Error('agent crashed');
        },
      };

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        tool.call({ query: 'crash' }, ctx),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('agent crashed');
    }));

  it(
    'should propagate parent abort to child agent',
    () =>
      wrapTrace(async () => {
        let childAbortSignal: AbortSignal | undefined;

        const instance: any = {
          id: AgentIds.REACT,
          config: {
            name: 'react_agent',
            description: 'test',
            tools: [],
          },
          logger: {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
          },
          tools: [],
          get systemPrompt() {
            return Prompt.empty();
          },
          async *call(_memory: Memory, childCtx: ExecutionContext) {
            childAbortSignal = childCtx.signal;
            // Simulate long-running agent that waits until aborted
            await new Promise((resolve, reject) => {
              childCtx.signal.addEventListener('abort', () =>
                reject(new Error('user aborted')),
              );
              setTimeout(resolve, 30000);
            });
          },
        };

        resolveSpy.mockImplementation((token: any) => {
          if (token === MemoryIds.CHILD) return mockChildMemory;
          if (token === AgentIds.REACT) return instance;
          return originalResolve(token);
        });

        const parentController = new AbortController();
        const ctx = new ExecutionContext(parentController, 'test-msg');

        const collectPromise = collectEvents(
          tool.call({ query: 'slow task' }, ctx),
        );

        // Wait for child to start and capture signal
        await new Promise(resolve => setTimeout(resolve, 50));

        // Abort parent
        parentController.abort(new Error('user aborted'));

        const { result } = await collectPromise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('user aborted');
        expect(childAbortSignal!.aborted).toBe(true);
      }),
    10000,
  );

  it('should pass context and query to child memory', () =>
    wrapTrace(async () => {
      const { instance } = createMockAgent(AgentIds.REACT, [
        { type: 'start', messageId: 'child-msg', seq: 1, at: Date.now() },
        {
          type: 'stream',
          messageId: 'child-msg',
          content: 'result',
          seq: 2,
          at: Date.now(),
        },
        { type: 'final', messageId: 'child-msg', seq: 3, at: Date.now() },
      ]);

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const parentController = new AbortController();
      const ctx = new ExecutionContext(parentController, 'test-msg');
      await collectEvents(
        tool.call(
          {
            query: 'analyze this',
            context: 'file: report.pdf',
          },
          ctx,
        ),
      );

      expect(mockChildMemory.setContext).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'file: report.pdf',
            meta: { hidden: true },
          }),
          expect.objectContaining({
            role: 'user',
            content: 'analyze this',
          }),
        ]),
      );
    }));

  it('should use default timeout when not specified', () =>
    wrapTrace(async () => {
      const { instance } = createMockAgent(AgentIds.REACT, [
        {
          type: 'stream',
          messageId: 'child-msg',
          content: 'done',
          seq: 1,
          at: Date.now(),
        },
      ]);

      resolveSpy.mockImplementation((token: any) => {
        if (token === MemoryIds.CHILD) return mockChildMemory;
        if (token === AgentIds.REACT) return instance;
        return originalResolve(token);
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(tool.call({ query: 'go' }, ctx));

      expect(result.success).toBe(true);
    }));
});
