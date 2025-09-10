import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReActAgent, {
  type ReActAgentCallInput,
} from '@/server/core/agent/ReAct';

// Mock LlmCallTool
const mockLlmCall = {
  call: vi.fn(),
};

// Create a simple mock container implementation
vi.mock('tsyringe', () => {
  const mockContainer = {
    resolve: vi.fn().mockImplementation(token => {
      if (token.name === 'LlmCallTool') {
        return mockLlmCall;
      }
      return mockTestTool;
    }),
  };

  return {
    container: mockContainer,
    inject: () => () => {},
    injectable: () => () => {},
  };
});

// Mock tool for testing action execution
const mockTestTool = {
  call: vi.fn(),
};

describe('ReActAgent', () => {
  let reactAgent: ReActAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create ReActAgent instance without using decorators
    reactAgent = new ReActAgent();
  });

  describe('parseResponse', () => {
    it('should parse thought response', () => {
      const content = 'Thought: I need to analyze the user query.';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: content });
    });

    it('should parse thought response with lowercase', () => {
      const content = 'thought: I need to analyze the user query.';
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ thought: content });
    });

    it('should parse action response', () => {
      const content = `Action: test_tool
Action Input: {"param": "value"}`;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: 'test_tool',
        actionInput: { param: 'value' },
      });
    });

    it('should parse action response with lowercase', () => {
      const content = `action: test_tool
action input: {"param": "value"}`;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({
        action: 'test_tool',
        actionInput: { param: 'value' },
      });
    });

    it('should parse final answer response', () => {
      const content = `Final Answer: This is the final answer.`;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ finalAnswer: 'This is the final answer.' });
    });

    it('should parse final answer response with lowercase', () => {
      const content = `final answer: This is the final answer.`;
      const result = (reactAgent as any).parseResponse(content);
      expect(result).toEqual({ finalAnswer: 'This is the final answer.' });
    });

    it('should throw error for action without action input', () => {
      const content = `Action: test_tool`;
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Action provided without Action Input',
      );
    });

    it('should throw error for invalid JSON in action input', () => {
      const content = `Action: test_tool
Action Input: {invalid json}`;
      expect(() => (reactAgent as any).parseResponse(content)).toThrow(
        'Invalid JSON in Action Input',
      );
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
              content: 'Final Answer: This is the final answer.',
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

      const input: ReActAgentCallInput = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await reactAgent.streamCall(
        {
          conversationId: 'test-conversation',
          outputStream: mockOutputStream as any,
        },
        input,
      );

      expect(mockLlmCall.call).toHaveBeenCalled();
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Final Answer: This is the final answer.',
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
              content: `Action: test_tool
Action Input: {"param": "value"}`,
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
              content: 'Final Answer: This is the final answer after action.',
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

      const input: ReActAgentCallInput = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await reactAgent.streamCall(
        {
          conversationId: 'test-conversation',
          outputStream: mockOutputStream as any,
        },
        input,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(`Action: test_tool
Action Input: {"param": "value"}`);
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Final Answer: This is the final answer after action.',
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
              content: `Action: test_tool
Action Input: {"param": "value"}`,
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
              content: 'Final Answer: This is the final answer after error.',
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

      const input: ReActAgentCallInput = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await reactAgent.streamCall(
        {
          conversationId: 'test-conversation',
          outputStream: mockOutputStream as any,
        },
        input,
      );

      expect(mockLlmCall.call).toHaveBeenCalledTimes(2);
      expect(mockWriter.write).toHaveBeenCalledWith(`Action: test_tool
Action Input: {"param": "value"}`);
      expect(mockWriter.write).toHaveBeenCalledWith(
        'Final Answer: This is the final answer after error.',
      );
      expect(mockWriter.close).toHaveBeenCalled();
    });
  });
});
