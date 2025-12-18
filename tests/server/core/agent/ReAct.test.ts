import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReActAgent from '@/server/core/agent/ReAct';
import { Role, Message } from '@/shared/entities/Message';

// Mock lodash-es
vi.mock('lodash-es', () => ({
  isEmpty: vi.fn().mockImplementation((obj: any) => {
    return obj == null || Object.keys(obj).length === 0;
  }),
}));

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
      if (token === 'LlmCall Tool') {
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
    // Manually set the tools property for testing with name as instance property
    const mockToolWithName = Object.create(mockTestTool);
    mockToolWithName.name = 'test_tool';
    (reactAgent as any).tools = [mockToolWithName];
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalled();
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith('Action: test_tool\n');
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Action Input: {"param":"value"}\n',
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Observation: {"result":"test result"}\n',
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Observation: Error executing tool "test_tool": Test error\n',
      );
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Thought: I need to think about this.\n',
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

      // Mock to always return thought responses
      mockLlmCall.call.mockResolvedValue(mockThoughtResponse);

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(5); // maxIterations
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Max iterations reached without final answer.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockWriter.write).toHaveBeenCalledWith('No response from model');
      expect(mockWriter.close).toHaveBeenCalled();
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.stringContaining('Observation: Error parsing response:'),
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Observation: Error parsing response: Unrecognized JSON structure: missing `thought`, `action`, or `final_answer`\n',
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

      // Mock parseResponse to return empty object for this test
      const originalParseResponse = (reactAgent as any).parseResponse;
      (reactAgent as any).parseResponse = vi.fn().mockReturnValueOnce({});
      (reactAgent as any).parseResponse.mockImplementationOnce(() => ({}));

      const mockWriter = {
        write: vi.fn(),
        close: vi.fn(),
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockWriter.write).toHaveBeenCalledWith(
        'Observation: Error parsing response: Parsed response is empty\n',
      );

      // Restore original method
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
      };

      const mockOutputStream = {
        getWriter: vi.fn().mockReturnValue(mockWriter),
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

      await reactAgent.streamCall(messages, mockOutputStream as any);

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith('Action: unknown_tool\n');
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Action Input: {"param":"value"}\n',
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        expect.stringContaining('Observation: Tool "unknown_tool" not found'),
      );
      expect(mockWriter.write).toHaveBeenCalledWith(
        'This is the final answer after tool not found.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });
  });
});
