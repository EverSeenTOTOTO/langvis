import ReActAgent from '@/server/core/agent/ReAct';
import { ExecutionContext } from '@/server/core/context';
import { Memory } from '@/server/core/memory';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
import { AgentEvent, ToolEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

const mockLlmCall = {
  call: vi.fn(),
};

const mockTestTool = {
  call: vi.fn(),
};

vi.mock('tsyringe', async importOriginal => {
  const actual: any = await importOriginal();
  const mockContainer = {
    resolve: vi.fn().mockImplementation((token: any) => {
      if (token === ToolIds.LLM_CALL) {
        return mockLlmCall;
      }
      if (token === 'test_tool') {
        return mockTestTool;
      }
      throw new Error(
        `No matching bindings found for serviceIdentifier: ${token}`,
      );
    }),
    register: vi.fn(),
  };

  return {
    ...actual,
    container: mockContainer,
    inject: () => () => {},
    injectable: () => () => {},
  };
});

const createMockMemory = (messages: Message[]): Memory => {
  return {
    summarize: vi.fn().mockResolvedValue(messages),
    store: vi.fn(),
    retrieve: vi.fn(),
    clearByConversationId: vi.fn(),
    clearByUserId: vi.fn(),
    setConversationId: vi.fn(),
    setUserId: vi.fn(),
    conversationId: undefined,
    userId: undefined,
  } as unknown as Memory;
};

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
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

function createLlmMockGenerator(content: string) {
  return async function* (): AsyncGenerator<ToolEvent, string, void> {
    yield {
      type: 'progress',
      toolName: 'llm-call',
      data: content,
    };
    yield {
      type: 'result',
      toolName: 'llm-call',
      output: JSON.stringify(content),
    };
    return content;
  };
}

function createToolMockGenerator(result: unknown) {
  return async function* (): AsyncGenerator<ToolEvent, any, void> {
    yield {
      type: 'result',
      toolName: 'test_tool',
      output: JSON.stringify(result),
    };
    return result;
  };
}

describe('ReActAgent', () => {
  let reactAgent: ReActAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    reactAgent = new ReActAgent();
    (reactAgent as any).logger = logger;
    const mockToolWithConfig = Object.create(mockTestTool);
    mockToolWithConfig.config = {
      name: 'test_tool',
      description: 'Test tool description',
    };
    (reactAgent as any).tools = [mockToolWithConfig];
  });

  describe('parseResponse', () => {
    it('should parse action without thought', () => {
      const content =
        '{"action": {"tool": "test_tool", "input": {"param": "value"}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse action with thought', () => {
      const content =
        '{"thought": "Need to use test tool", "action": {"tool": "test_tool", "input": {"param": "value"}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'Need to use test tool',
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse final_answer without thought', () => {
      const content = '{"final_answer": "This is the answer."}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        final_answer: 'This is the answer.',
      });
    });

    it('should parse final_answer with thought', () => {
      const content =
        '{"thought": "I have the answer now", "final_answer": "This is the answer."}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'I have the answer now',
        final_answer: 'This is the answer.',
      });
    });

    it('should handle invalid action format', () => {
      const content = '{"action": "invalid_action_format"}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid action format: missing or invalid tool/input',
      );
    });

    it('should handle unrecognized JSON structure', () => {
      const content = '{"unknown_field": "value"}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Unrecognized JSON structure: missing `action` or `final_answer`',
      );
    });

    it('should handle markdown wrapped JSON', () => {
      const content =
        '```json\n{"thought": "Testing", "action": {"tool": "test_tool", "input": {"param": "value"}}}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'Testing',
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });
  });

  describe('executeAction', () => {
    it('should execute tool successfully', async () => {
      const ctx = createMockContext();
      mockTestTool.call.mockImplementation(
        createToolMockGenerator({ result: 'success' }),
      );
      const generator = (reactAgent as any).executeAction(
        'test_tool',
        {
          param: 'value',
        },
        ctx,
      );
      const events: AgentEvent[] = [];
      let result = '';
      for await (const event of generator) {
        events.push(event);
        if (event.type === 'tool_result') {
          result = event.output;
        }
      }
      expect(result).toBe('{"result":"success"}');
    });

    it('should handle tool execution error', async () => {
      const ctx = createMockContext();
      mockTestTool.call.mockImplementation(async function* (): AsyncGenerator<
        ToolEvent,
        void,
        void
      > {
        yield {
          type: 'progress',
          toolName: 'test_tool',
          data: '',
        };
        throw new Error('Tool error');
      });

      // executeAction generator catches internal errors and returns error message
      const generator = (reactAgent as any).executeAction(
        'test_tool',
        { param: 'value' },
        ctx,
      );

      // Manually iterate to capture return value
      const events: AgentEvent[] = [];
      let iterResult = await generator.next();
      while (!iterResult.done) {
        events.push(iterResult.value as AgentEvent);
        iterResult = await generator.next();
      }

      // iterResult.value should contain the error message
      expect(iterResult.value).toContain('Error executing tool "test_tool"');
      expect(iterResult.value).toContain('Tool error');
    });
  });

  describe('call', () => {
    it('should yield final answer without thought', async () => {
      const ctx = createMockContext();
      mockLlmCall.call.mockImplementation(
        createLlmMockGenerator('{"final_answer": "This is the final answer."}'),
      );

      const messages: Message[] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          meta: {},
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
      ];

      const events = await collectEvents(
        reactAgent.call(createMockMemory(messages), ctx),
      );

      expect(mockLlmCall.call).toHaveBeenCalled();

      const streamEvents = events.filter(e => e.type === 'stream');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0]).toMatchObject({
        type: 'stream',
        content: 'This is the final answer.',
      });

      const finalEvents = events.filter(e => e.type === 'final');
      expect(finalEvents).toHaveLength(1);
    });

    it('should yield thought and stream events', async () => {
      const ctx = createMockContext();
      mockLlmCall.call.mockImplementation(
        createLlmMockGenerator(
          '{"thought": "I have the answer", "final_answer": "This is the final answer."}',
        ),
      );

      const messages: Message[] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          meta: {},
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
      ];

      const events = await collectEvents(
        reactAgent.call(createMockMemory(messages), ctx),
      );

      const thoughtEvents = events.filter(e => e.type === 'thought');
      expect(thoughtEvents).toHaveLength(1);
      expect(thoughtEvents[0]).toMatchObject({
        type: 'thought',
        content: 'I have the answer',
      });

      const streamEvents = events.filter(e => e.type === 'stream');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0]).toMatchObject({
        type: 'stream',
        content: 'This is the final answer.',
      });
    });

    it('should execute action and yield action event', async () => {
      const ctx = createMockContext();
      mockLlmCall.call
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"thought": "Using tool", "action": {"tool": "test_tool", "input": {"param": "value"}}}',
          ),
        )
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"final_answer": "This is the final answer after action."}',
          ),
        );

      mockTestTool.call.mockImplementation(
        createToolMockGenerator({ result: 'test result' }),
      );

      const messages: Message[] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          meta: {},
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
      ];

      const events = await collectEvents(
        reactAgent.call(createMockMemory(messages), ctx),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const thoughtEvents = events.filter(e => e.type === 'thought');
      expect(thoughtEvents).toHaveLength(1);

      const actionEvents = events.filter(e => e.type === 'tool_call');
      expect(actionEvents).toHaveLength(1);
      expect(actionEvents[0]).toMatchObject({
        type: 'tool_call',
        toolName: 'test_tool',
        toolArgs: '{"param":"value"}',
      });

      const streamEvents = events.filter(e => e.type === 'stream');
      expect(streamEvents).toHaveLength(1);
      expect(streamEvents[0]).toMatchObject({
        type: 'stream',
        content: 'This is the final answer after action.',
      });
    });

    it('should handle max iterations reached', async () => {
      const ctx = createMockContext();
      mockLlmCall.call.mockImplementation(
        createLlmMockGenerator(
          '{"action": {"tool": "test_tool", "input": {"param": "value"}}}',
        ),
      );
      mockTestTool.call.mockImplementation(
        createToolMockGenerator({ result: 'success' }),
      );

      const messages: Message[] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          meta: {},
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
      ];

      const events = await collectEvents(
        reactAgent.call(createMockMemory(messages), ctx),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(reactAgent.maxIterations);

      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        error: 'Max iterations reached',
      });
    });

    it('should handle empty response content', async () => {
      const ctx = createMockContext();
      mockLlmCall.call.mockImplementation(async function* (): AsyncGenerator<
        ToolEvent,
        string,
        void
      > {
        yield {
          type: 'result',
          toolName: 'llm-call',
          output: JSON.stringify(''),
        };
        return '';
      });

      const messages: Message[] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          meta: {},
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
      ];

      const events = await collectEvents(
        reactAgent.call(createMockMemory(messages), ctx),
      );

      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        error: 'No response from model',
      });
    });
  });
});
