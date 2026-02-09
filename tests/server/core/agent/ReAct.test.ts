import ReActAgent from '@/server/core/agent/ReAct';
import { Memory } from '@/server/core/memory';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
import { AgentEvent } from '@/shared/types';
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
  return async function* () {
    yield { type: 'delta' as const, data: content };
    yield { type: 'result' as const, result: content };
  };
}

function createToolMockGenerator(result: unknown) {
  return async function* () {
    yield { type: 'result' as const, result };
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

    it('should parse action with markdown code blocks', () => {
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

    it('should parse final_answer with markdown code blocks', () => {
      const content =
        '```json\n{"thought": "Answering user", "final_answer": "This is the answer."}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'Answering user',
        final_answer: 'This is the answer.',
      });
    });

    it('should parse final_answer with complex content', () => {
      const content =
        '```json\n{"final_answer": "Result:\\n1. First\\n2. Second"}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        final_answer: 'Result:\n1. First\n2. Second',
      });
    });

    it('should handle invalid action format', () => {
      const content = '{"action": "invalid_action_format"}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid action format: missing or invalid tool/input',
      );
    });

    it('should handle action with missing tool', () => {
      const content = '{"action": {"input": {"param": "value"}}}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid action format: missing or invalid tool/input',
      );
    });

    it('should handle action with missing input', () => {
      const content = '{"action": {"tool": "test_tool"}}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid action format: missing or invalid tool/input',
      );
    });

    it('should handle action with empty tool name', () => {
      const content = '{"action": {"tool": "", "input": {}}}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid action format: missing or invalid tool/input',
      );
    });

    it('should handle action with empty input', () => {
      const content = '{"action": {"tool": "test_tool", "input": {}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        action: {
          tool: 'test_tool',
          input: {},
        },
      });
    });

    it('should handle unrecognized JSON structure', () => {
      const content = '{"unknown_field": "value"}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Unrecognized JSON structure: missing `action` or `final_answer`',
      );
    });

    it('should throw on invalid JSON', () => {
      const content = 'Invalid JSON content';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should throw on malformed markdown JSON', () => {
      const content = '```json\n{invalid json}\n```';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should handle JSON content containing ```json strings in action', () => {
      const content = JSON.stringify({
        action: {
          tool: 'test_tool',
          input: { code: '```json\n{"test": "value"}\n```' },
        },
      });
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        action: {
          tool: 'test_tool',
          input: { code: '```json\n{"test": "value"}\n```' },
        },
      });
    });

    it('should handle markdown wrapped JSON with internal ```json content', () => {
      const innerContent = JSON.stringify({
        final_answer: 'Use format: ```json\n{"key": "value"}\n```',
      });
      const content = `\`\`\`json\n${innerContent}\n\`\`\``;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        final_answer: 'Use format: ```json\n{"key": "value"}\n```',
      });
    });

    it('should handle complex action with thought and internal json', () => {
      const innerContent = JSON.stringify({
        thought: 'Generating code',
        action: {
          tool: 'code_gen',
          input: {
            template: 'Use ```json format for: ```json\n{"data": "here"}\n```',
          },
        },
      });
      const content = `\`\`\`json\n${innerContent}\n\`\`\``;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'Generating code',
        action: {
          tool: 'code_gen',
          input: {
            template: 'Use ```json format for: ```json\n{"data": "here"}\n```',
          },
        },
      });
    });

    it('should handle nested JSON in final answer', () => {
      const content = '{"final_answer": "Result: {\\"key\\": \\"value\\"}"}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        final_answer: 'Result: {"key": "value"}',
      });
    });

    it('should prioritize action when both action and final_answer present', () => {
      const content =
        '{"thought": "thinking", "action": {"tool": "test", "input": {}}, "final_answer": "answer"}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: 'thinking',
        action: {
          tool: 'test',
          input: {},
        },
      });
    });

    it('should handle only opening markdown block', () => {
      const content =
        '```json\n{"action": {"tool": "test_tool", "input": {"param": "value"}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should handle only closing markdown block', () => {
      const content =
        '{"action": {"tool": "test_tool", "input": {"param": "value"}}}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        thought: undefined,
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });
  });

  describe('executeAction', () => {
    it('should return tool not found message for non-existent tool', async () => {
      const result = await (reactAgent as any).executeAction(
        'non_existent_tool',
        { param: 'value' },
      );
      expect(result).toContain(
        'Error executing tool "non_existent_tool": No matching bindings found for serviceIdentifier: non_existent_tool',
      );
    });

    it('should execute tool successfully', async () => {
      mockTestTool.call.mockImplementation(
        createToolMockGenerator({ result: 'success' }),
      );
      const result = await (reactAgent as any).executeAction('test_tool', {
        param: 'value',
      });
      expect(result).toBe('{"result":"success"}');
    });

    it('should handle tool execution error', async () => {
      mockTestTool.call.mockImplementation(async function* () {
        yield { type: 'delta' as const, data: '' };
        throw new Error('Tool error');
      });
      const result = await (reactAgent as any).executeAction('test_tool', {
        param: 'value',
      });
      expect(result).toContain('Error executing tool "test_tool"');
      expect(result).toContain('Tool error');
    });
  });

  describe('call', () => {
    it('should yield final answer without thought', async () => {
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalled();

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual({
        type: 'meta',
        meta: {
          steps: [
            { thought: undefined, final_answer: 'This is the final answer.' },
          ],
        },
      });

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'This is the final answer.',
      });

      expect(events[events.length - 1]).toEqual({
        type: 'end',
        agentId: undefined,
      });
    });

    it('should yield final answer with thought', async () => {
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalled();

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual({
        type: 'meta',
        meta: {
          steps: [
            {
              thought: 'I have the answer',
              final_answer: 'This is the final answer.',
            },
          ],
        },
      });

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'This is the final answer.',
      });
    });

    it('should execute action and continue loop', async () => {
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              {
                thought: 'Using tool',
                action: { tool: 'test_tool', input: { param: 'value' } },
              },
            ]),
          },
        }),
      );
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              { observation: '{"result":"test result"}' },
            ]),
          },
        }),
      );

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'This is the final answer after action.',
      });
    });

    it('should handle action execution error', async () => {
      mockLlmCall.call
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"action": {"tool": "test_tool", "input": {"param": "value"}}}',
          ),
        )
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"final_answer": "This is the final answer after error."}',
          ),
        );

      mockTestTool.call.mockImplementation(async function* () {
        yield { type: 'delta' as const, data: '' };
        throw new Error('Test error');
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaEvents = events.filter(e => e.type === 'meta');
      const lastMetaEvent = metaEvents[metaEvents.length - 1];
      const lastSteps = (lastMetaEvent as any).meta.steps;

      expect(lastSteps).toContainEqual({
        thought: undefined,
        action: { tool: 'test_tool', input: { param: 'value' } },
      });
      expect(lastSteps).toContainEqual(
        expect.objectContaining({
          observation: expect.stringContaining('Error executing'),
        }),
      );
      expect(lastSteps).toContainEqual({
        thought: undefined,
        final_answer: 'This is the final answer after error.',
      });

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'This is the final answer after error.',
      });
    });

    it('should handle max iterations reached', async () => {
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(reactAgent.maxIterations);

      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents).toContainEqual({
        type: 'error',
        error: expect.objectContaining({
          message: 'Max iterations reached',
        }),
      });
    });

    it('should handle empty response content', async () => {
      mockLlmCall.call.mockImplementation(async function* () {
        yield { type: 'result' as const, result: '' };
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
        reactAgent.call(createMockMemory(messages)),
      );

      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents).toContainEqual({
        type: 'error',
        error: expect.objectContaining({
          message: 'No response from model',
        }),
      });
    });

    it('should handle unparseable response', async () => {
      mockLlmCall.call
        .mockImplementationOnce(
          createLlmMockGenerator('This is not parseable content'),
        )
        .mockImplementationOnce(
          createLlmMockGenerator('{"final_answer": "Final answer"}'),
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              expect.objectContaining({
                observation: expect.stringContaining('Error parsing response:'),
              }),
            ]),
          },
        }),
      );

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'Final answer',
      });
    });

    it('should handle empty parsed response during streaming', async () => {
      mockLlmCall.call
        .mockImplementationOnce(createLlmMockGenerator('{}'))
        .mockImplementationOnce(
          createLlmMockGenerator('{"final_answer": "Final answer"}'),
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              {
                observation:
                  'Error parsing response: Unrecognized JSON structure: missing `action` or `final_answer`',
              },
            ]),
          },
        }),
      );

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'Final answer',
      });
    });

    it('should handle tool not found during action execution', async () => {
      mockLlmCall.call
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"action": {"tool": "unknown_tool", "input": {"param": "value"}}}',
          ),
        )
        .mockImplementationOnce(
          createLlmMockGenerator(
            '{"final_answer": "This is the final answer after tool not found."}',
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
        reactAgent.call(createMockMemory(messages)),
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaEvents = events.filter(e => e.type === 'meta');
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              {
                thought: undefined,
                action: { tool: 'unknown_tool', input: { param: 'value' } },
              },
            ]),
          },
        }),
      );
      expect(metaEvents).toContainEqual(
        expect.objectContaining({
          type: 'meta',
          meta: {
            steps: expect.arrayContaining([
              expect.objectContaining({
                observation: expect.stringContaining(
                  'Error executing tool "unknown_tool": No matching bindings found for serviceIdentifier: unknown_tool',
                ),
              }),
            ]),
          },
        }),
      );

      const deltaEvents = events.filter(e => e.type === 'delta');
      expect(deltaEvents).toContainEqual({
        type: 'delta',
        content: 'This is the final answer after tool not found.',
      });
    });
  });
});
