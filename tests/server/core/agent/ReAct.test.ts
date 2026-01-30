import ReActAgent from '@/server/core/agent/ReAct';
import { Memory } from '@/server/core/memory';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
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
      expect(result).toContain('Tool "non_existent_tool" not found');
      expect(result).toContain('available tools: `test_tool`');
    });

    it('should execute tool successfully', async () => {
      mockTestTool.call.mockResolvedValue({ result: 'success' });
      const result = await (reactAgent as any).executeAction('test_tool', {
        param: 'value',
      });
      expect(result).toBe('{"result":"success"}');
    });

    it('should handle tool execution error', async () => {
      mockTestTool.call.mockRejectedValue(new Error('Tool error'));
      const result = await (reactAgent as any).executeAction('test_tool', {
        param: 'value',
      });
      expect(result).toContain('Error executing tool "test_tool"');
      expect(result).toContain('Tool error');
    });
  });

  describe('streamCall', () => {
    it('should stream final answer without thought', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"final_answer": "This is the final answer."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call.mockResolvedValue(mockResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalled();
      expect(mockWriter.write).toHaveBeenCalledWith({
        meta: {
          steps: [
            { thought: undefined, final_answer: 'This is the final answer.' },
          ],
        },
      });
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should stream final answer with thought', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"thought": "I have the answer", "final_answer": "This is the final answer."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call.mockResolvedValue(mockResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalled();
      expect(mockWriter.write).toHaveBeenCalledWith({
        meta: {
          steps: [
            {
              thought: 'I have the answer',
              final_answer: 'This is the final answer.',
            },
          ],
        },
      });
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should execute action and continue loop', async () => {
      const mockActionResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"thought": "Using tool", "action": {"tool": "test_tool", "input": {"param": "value"}}}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      const mockFinalResponse = {
        id: 'test-id-2',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"final_answer": "This is the final answer after action."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockActionResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      mockTestTool.call.mockResolvedValue({ result: 'test result' });

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
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
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              { observation: '{"result":"test result"}' },
            ]),
          },
        }),
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after action.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle action execution error', async () => {
      const mockActionResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"action": {"tool": "test_tool", "input": {"param": "value"}}}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      const mockFinalResponse = {
        id: 'test-id-2',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"final_answer": "This is the final answer after error."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockActionResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      mockTestTool.call.mockRejectedValue(new Error('Test error'));

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaCalls = mockWriter.write.mock.calls.filter(
        call => call[0]?.meta?.steps,
      );
      const lastMetaCall = metaCalls[metaCalls.length - 1];
      const lastSteps = lastMetaCall[0].meta.steps;

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

      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after error.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle max iterations reached', async () => {
      const mockActionResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"action": {"tool": "test_tool", "input": {"param": "value"}}}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call.mockResolvedValue(mockActionResponse);
      mockTestTool.call.mockResolvedValue({ result: 'success' });

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(reactAgent.maxIterations);
      expect(mockWriter.abort).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Max iterations reached',
        }),
      );
    });

    it('should handle empty response content', async () => {
      const mockResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: null,
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call.mockResolvedValue(mockResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockWriter.abort).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No response from model',
        }),
      );
    });

    it('should handle unparseable response', async () => {
      const mockUnparseableResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: 'This is not parseable content',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      const mockFinalResponse = {
        id: 'test-id-2',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"final_answer": "Final answer"}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockUnparseableResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              expect.objectContaining({
                observation: expect.stringContaining('Error parsing response:'),
              }),
            ]),
          },
        }),
      );
      expect(mockWriter.write).toHaveBeenCalledWith('Final answer');
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle empty parsed response during streaming', async () => {
      const mockEmptyResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      const mockFinalResponse = {
        id: 'test-id-2',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"final_answer": "Final answer"}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockEmptyResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
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
      expect(mockWriter.write).toHaveBeenCalledWith('Final answer');
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle tool not found during action execution', async () => {
      const mockActionResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"action": {"tool": "unknown_tool", "input": {"param": "value"}}}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      const mockFinalResponse = {
        id: 'test-id-2',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content:
                '{"final_answer": "This is the final answer after tool not found."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockActionResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      };

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

      await reactAgent.streamCall(
        createMockMemory(messages),
        mockWriter as any,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
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
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              expect.objectContaining({
                observation: expect.stringContaining(
                  'Tool "unknown_tool" not found',
                ),
              }),
            ]),
          },
        }),
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after tool not found.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });
  });
});
