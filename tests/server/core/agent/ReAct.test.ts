import ReActAgent from '@/server/core/agent/ReAct';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

const mockLlmCallTool = {
  call: vi.fn(),
};

const mockNestedTool = {
  call: vi.fn(),
};

vi.mock('tsyringe', async () => {
  const actual = await vi.importActual('tsyringe');
  return {
    ...actual,
    container: {
      resolve: vi.fn((token: string) => {
        if (token === ToolIds.LLM_CALL) {
          return mockLlmCallTool;
        }
        if (token === 'nested_tool') {
          return mockNestedTool;
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

describe('ReActAgent', () => {
  let reactAgent: ReActAgent;

  beforeEach(() => {
    reactAgent = new ReActAgent();
    Object.defineProperty(reactAgent, 'logger', {
      value: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    Object.defineProperty(reactAgent, 'id', {
      value: 'react',
    });
    Object.defineProperty(reactAgent, 'tools', {
      value: [],
    });
    vi.clearAllMocks();
  });

  it('should correctly handle tool execution with nested sub-tools', async () => {
    /**
     * Tools now yield only tool_progress events and return results.
     * Agent is responsible for emitting tool_call/tool_result/tool_error.
     */
    const memory = {
      summarize: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'test query' }]),
    } as any;
    const ctx = createMockContext();

    // Mock LLM to first return an action, then a final answer
    let llmCallCount = 0;
    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      string,
      void
    > {
      llmCallCount++;
      yield ctx.agentToolProgressEvent(ToolIds.LLM_CALL, {
        step: llmCallCount,
      });
      if (llmCallCount === 1) {
        return JSON.stringify({
          thought: 'I need to call nested_tool',
          action: { tool: 'nested_tool', input: { query: 'test' } },
        });
      } else {
        return JSON.stringify({
          thought: 'Tool executed successfully',
          final_answer: 'Done',
        });
      }
    });

    // Mock nested_tool that yields progress and returns result
    mockNestedTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      { documentId: string },
      void
    > {
      yield ctx.agentToolProgressEvent('nested_tool', { step: 1 });
      yield ctx.agentToolProgressEvent('nested_tool', { step: 2 });
      return { documentId: 'doc_123' };
    });

    const events = await collectEvents(reactAgent.call(memory, ctx, {}));

    // Should have tool_call and tool_result for nested_tool
    const toolCallEvent = events.find(e => e.type === 'tool_call');
    expect(toolCallEvent).toMatchObject({
      type: 'tool_call',
      toolName: 'nested_tool',
    });

    const toolResultEvent = events.find(e => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({
      type: 'tool_result',
      toolName: 'nested_tool',
    });

    // Should have a final event
    expect(events.find(e => e.type === 'final')).toBeDefined();

    // LLM should be called twice
    expect(llmCallCount).toBe(2);
  });

  it('should return final answer correctly', async () => {
    const memory = {
      summarize: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'hello' }]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      string,
      void
    > {
      yield ctx.agentToolProgressEvent(ToolIds.LLM_CALL, { step: 1 });
      return JSON.stringify({
        thought: 'Simple greeting',
        final_answer: 'Hello! How can I help you?',
      });
    });

    const events = await collectEvents(reactAgent.call(memory, ctx, {}));

    expect(events[0]).toMatchObject({ type: 'start' });
    expect(events.find(e => e.type === 'thought')).toMatchObject({
      content: 'Simple greeting',
    });
    expect(events.find(e => e.type === 'stream')).toMatchObject({
      content: 'Hello! How can I help you?',
    });
    expect(events.find(e => e.type === 'final')).toBeDefined();
  });
});
