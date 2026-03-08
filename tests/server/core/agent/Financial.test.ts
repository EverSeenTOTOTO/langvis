import FinancialAgent from '@/server/core/agent/Financial';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLlmCallTool = {
  call: vi.fn(),
};

const mockPositionAdjustTool = {
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
        if (token === ToolIds.POSITION_ADJUST) {
          return mockPositionAdjustTool;
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

function createMockContext(traceId = 'test-trace-id'): ExecutionContext {
  return new ExecutionContext(traceId, new AbortController());
}

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, void, void>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('FinancialAgent', () => {
  let financialAgent: FinancialAgent;

  beforeEach(() => {
    financialAgent = new FinancialAgent();
    Object.defineProperty(financialAgent, 'logger', {
      value: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    Object.defineProperty(financialAgent, 'id', {
      value: 'financial_agent',
    });
    Object.defineProperty(financialAgent, 'tools', {
      value: [],
    });
    vi.clearAllMocks();
  });

  it('should have maxIterations set to 10', () => {
    expect(financialAgent.maxIterations).toBe(10);
  });

  it('should return final answer for simple financial question', async () => {
    const memory = {
      summarize: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: '什么是定投？' }]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      string,
      void
    > {
      yield ctx.agentToolProgressEvent(ToolIds.LLM_CALL, { step: 1 });
      return JSON.stringify({
        thought: 'Simple question about DCA',
        final_answer: '定投是指定期定额投资...',
      });
    });

    const events = await collectEvents(financialAgent.call(memory, ctx, {}));

    expect(events[0]).toMatchObject({ type: 'start' });
    expect(events.find(e => e.type === 'thought')).toMatchObject({
      content: 'Simple question about DCA',
    });
    expect(events.find(e => e.type === 'stream')).toMatchObject({
      content: '定投是指定期定额投资...',
    });
    expect(events.find(e => e.type === 'final')).toBeDefined();
  });

  it('should call PositionAdjustTool for position adjustment request', async () => {
    const memory = {
      summarize: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: '帮我看看仓位怎么调整' }]),
    } as any;
    const ctx = createMockContext();

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
          thought: 'User needs position adjustment',
          action: {
            tool: 'position_adjust_tool',
            input: { conversationId: 'conv_123' },
          },
        });
      }
      return JSON.stringify({
        thought: 'Position adjustment complete',
        final_answer: '根据您的资产配置...',
      });
    });

    mockPositionAdjustTool.call.mockImplementation(
      async function* (): AsyncGenerator<
        AgentEvent,
        { submitted: boolean; advice: string },
        void
      > {
        yield ctx.agentToolProgressEvent(ToolIds.POSITION_ADJUST, {
          status: 'awaiting_input',
        });
        return { submitted: true, advice: '建议减少股票仓位' };
      },
    );

    const events = await collectEvents(financialAgent.call(memory, ctx, {}));

    const toolCallEvent = events.find(e => e.type === 'tool_call');
    expect(toolCallEvent).toMatchObject({
      type: 'tool_call',
      toolName: 'position_adjust_tool',
    });

    const toolResultEvent = events.find(e => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();

    expect(events.find(e => e.type === 'final')).toBeDefined();
    expect(llmCallCount).toBe(2);
  });

  it('should refuse to recommend specific stocks', async () => {
    const memory = {
      summarize: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: '我应该买什么股票？' }]),
    } as any;
    const ctx = createMockContext();

    mockLlmCallTool.call.mockImplementation(async function* (): AsyncGenerator<
      AgentEvent,
      string,
      void
    > {
      yield ctx.agentToolProgressEvent(ToolIds.LLM_CALL, { step: 1 });
      return JSON.stringify({
        thought: 'Cannot recommend specific stocks',
        final_answer:
          '抱歉，我不能推荐具体的股票代码。但我可以帮您分析资产配置策略...',
      });
    });

    const events = await collectEvents(financialAgent.call(memory, ctx, {}));

    const streamEvent = events.find(e => e.type === 'stream');
    expect(streamEvent?.content).toContain('不能推荐');
    expect(events.find(e => e.type === 'final')).toBeDefined();
  });
});
