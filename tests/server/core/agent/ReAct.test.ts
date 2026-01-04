import ReActAgent from '@/server/core/agent/ReAct';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { Message, Role } from '@/shared/entities/Message';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
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

// Mock LlmCallTool
const mockLlmCall = {
  call: vi.fn(),
};

// Mock tool for testing action execution
const mockTestTool = {
  call: vi.fn(),
};

// Create a simple mock container implementation
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
      // Simulate tool not found
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

describe('ReActAgent', () => {
  let reactAgent: ReActAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create ReActAgent instance with required dependencies
    reactAgent = new ReActAgent();
    // Set the logger
    (reactAgent as any).logger = logger;
    // Manually set the tools property for testing with config structure
    const mockToolWithConfig = Object.create(mockTestTool);
    mockToolWithConfig.config = {
      name: { en: 'test_tool' },
      description: { en: 'Test tool description' },
    };
    (reactAgent as any).tools = [mockToolWithConfig];
  });

  describe('parseResponse', () => {
    it('should parse thought response', () => {
      const content = '{"thought": "I need to analyze the user query."}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: 'I need to analyze the user query.' });
    });

    it('should parse thought response with markdown code blocks', () => {
      const content =
        '```json\n{"thought": "I need to analyze the user query."}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: 'I need to analyze the user query.' });
    });

    it('should parse thought response with multiple markdown blocks', () => {
      const content =
        '```json\n```json\n{"thought": "I need to analyze the user query."}\n```\n```';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should parse thought response with mixed markdown and whitespace', () => {
      const content =
        '   ```json   \n  \n  {"thought": "I need to analyze the user query."}  \n  \n```   ';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: 'I need to analyze the user query.' });
    });

    it('should parse action response', () => {
      const content =
        '{"action": {"tool": "test_tool", "input": {"param": "value"}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse action response with markdown code blocks', () => {
      const content =
        '```json\n{"action": {"tool": "test_tool", "input": {"param": "value"}}}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse action response with only opening markdown block', () => {
      const content =
        '```json\n{"action": {"tool": "test_tool", "input": {"param": "value"}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse action response with only closing markdown block', () => {
      const content =
        '{"action": {"tool": "test_tool", "input": {"param": "value"}}}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: { param: 'value' },
        },
      });
    });

    it('should parse final answer response', () => {
      const content = '{"final_answer": "This is the final answer."}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ final_answer: 'This is the final answer.' });
    });

    it('should parse final answer response with markdown code blocks', () => {
      const content =
        '```json\n{"final_answer": "This is the final answer."}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ final_answer: 'This is the final answer.' });
    });

    it('should parse final answer with complex content', () => {
      const content =
        '```json\n{"final_answer": "根据分析，答案是：\\n1. 第一点\\n2. 第二点"}\n```';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        final_answer: '根据分析，答案是：\n1. 第一点\n2. 第二点',
      });
    });

    it('should handle response with extra text before JSON', () => {
      const content =
        'Here is my response:\n```json\n{"thought": "I need to think."}\n```';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should handle response with extra text after JSON', () => {
      const content =
        '```json\n{"thought": "I need to think."}\n```\nThis is additional text.';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
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

    it('should handle unrecognized JSON structure', () => {
      const content = '{"unknown_field": "value"}';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Unrecognized JSON structure: missing `thought`, `action`, or `final_answer`',
      );
    });

    it('should fallback to thought for invalid JSON', () => {
      const content = 'Invalid JSON content';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should fallback to thought for malformed markdown JSON', () => {
      const content = '```json\n{invalid json}\n```';
      expect(() => (reactAgent as any).parseResponse(content)).toThrow();
    });

    it('should handle empty action input', () => {
      const content = '{"action": {"tool": "test_tool", "input": {}}}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: {},
        },
      });
    });

    it('should handle JSON content containing ```json strings', () => {
      const content = JSON.stringify({
        action: {
          tool: 'test_tool',
          input: { code: '```json\n{"test": "value"}\n```' },
        },
      });
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test_tool',
          input: { code: '```json\n{"test": "value"}\n```' },
        },
      });
    });

    it('should handle markdown wrapped JSON with internal ```json content', () => {
      const innerContent = JSON.stringify({
        final_answer: '请使用格式：```json\n{"key": "value"}\n```',
      });
      const content = `\`\`\`json\n${innerContent}\n\`\`\``;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        final_answer: '请使用格式：```json\n{"key": "value"}\n```',
      });
    });

    it('should handle complex case with multiple ```json markers', () => {
      const innerContent = JSON.stringify({
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
        action: {
          tool: 'code_gen',
          input: {
            template: 'Use ```json format for: ```json\n{"data": "here"}\n```',
          },
        },
      });
    });

    it('should handle nested JSON in final answer', () => {
      const content = '{"final_answer": "结果：{\\"key\\": \\"value\\"}"}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        final_answer: '结果：{"key": "value"}',
      });
    });

    it('should parse response with all supported fields (prioritize correctly)', () => {
      // Should prioritize thought over other fields
      const content =
        '{"thought": "thinking", "action": {"tool": "test", "input": {}}, "final_answer": "answer"}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: 'thinking' });
    });

    it('should parse response with action and final_answer (prioritize action)', () => {
      const content =
        '{"action": {"tool": "test", "input": {}}, "final_answer": "answer"}';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: {
          tool: 'test',
          input: {},
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
  });

  describe('streamCall', () => {
    it('should stream final answer', async () => {
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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalled();
      expect(mockWriter.write).toHaveBeenCalledWith({
        meta: { steps: [{ final_answer: 'This is the final answer.' }] },
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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              { action: { tool: 'test_tool', input: { param: 'value' } } },
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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);

      const metaCalls = mockWriter.write.mock.calls.filter(
        call => call[0]?.meta?.steps,
      );
      const lastMetaCall = metaCalls[metaCalls.length - 1];
      const lastSteps = lastMetaCall[0].meta.steps;

      expect(lastSteps).toContainEqual({
        action: { tool: 'test_tool', input: { param: 'value' } },
      });
      expect(lastSteps).toContainEqual(
        expect.objectContaining({
          observation: expect.stringContaining('Error executing'),
        }),
      );
      expect(lastSteps).toContainEqual({
        final_answer: 'This is the final answer after error.',
      });

      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after error.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle thought response', async () => {
      const mockThoughtResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"thought": "I need to think about this."}',
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
                '{"final_answer": "This is the final answer after thinking."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567891,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call
        .mockResolvedValueOnce(mockThoughtResponse)
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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              { thought: 'I need to think about this.' },
            ]),
          },
        }),
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after thinking.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle max iterations reached', async () => {
      const mockThoughtResponse = {
        id: 'test-id',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"thought": "I keep thinking."}',
              role: 'assistant',
            },
          },
        ],
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        object: 'chat.completion',
      };

      mockLlmCall.call.mockResolvedValue(mockThoughtResponse);

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

      await reactAgent.streamCall(messages, mockWriter as any);

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

      await reactAgent.streamCall(messages, mockWriter as any);

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

      await reactAgent.streamCall(messages, mockWriter as any);

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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              {
                observation:
                  'Error parsing response: Unrecognized JSON structure: missing `thought`, `action`, or `final_answer`',
              },
            ]),
          },
        }),
      );
      expect(mockWriter.write).toHaveBeenCalledWith('Final answer');
      expect(mockWriter.close).toHaveBeenCalled();
    });

    it('should handle when parseResponse returns empty object', async () => {
      const mockResponse = {
        id: 'test-id-1',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: {
              content: '{"valid": "json"}',
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
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockFinalResponse);

      const originalParseResponse = (reactAgent as any).parseResponse;
      (reactAgent as any).parseResponse = vi.fn().mockReturnValueOnce({});
      (reactAgent as any).parseResponse.mockImplementationOnce(() => ({}));

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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              {
                observation: 'Error parsing response: Parsed response is empty',
              },
            ]),
          },
        }),
      );

      (reactAgent as any).parseResponse = originalParseResponse;
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

      await reactAgent.streamCall(messages, mockWriter as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            steps: expect.arrayContaining([
              { action: { tool: 'unknown_tool', input: { param: 'value' } } },
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
