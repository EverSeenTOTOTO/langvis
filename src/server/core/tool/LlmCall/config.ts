import { ToolConfig } from '@/shared/types';

export const config: ToolConfig = {
  name: {
    en: 'LlmCall Tool',
    zh: '大模型调用工具',
  },
  description: {
    en: 'A tool to perform a single call of Llm.',
    zh: '执行单次大语言模型调用的工具。',
  },
  input: {
    description: {
      en: 'OpenAI Chat Completion API parameters',
      zh: 'OpenAI 聊天补全 API 参数',
    },
    parameters: {
      model: {
        type: 'string',
        required: false,
        description: {
          en: 'The model to use for completion. Defaults to OPENAI_MODEL environment variable if not specified.',
          zh: '用于补全的模型。如果未指定，默认使用 OPENAI_MODEL 环境变量。',
        },
      },
      messages: {
        type: 'array',
        required: false,
        default: [],
        description: {
          en: 'Array of message objects in OpenAI format. Each message should have "role" and "content" fields.',
          zh: 'OpenAI 格式的消息对象数组。每条消息应包含 "role" 和 "content" 字段。',
        },
      },
      temperature: {
        type: 'number',
        required: false,
        range: '0-2',
        description: {
          en: 'Sampling temperature between 0 and 2. Higher values make output more random.',
          zh: '采样温度，范围 0 到 2。值越高，输出越随机。',
        },
      },
      max_tokens: {
        type: 'number',
        required: false,
        description: {
          en: 'Maximum number of tokens to generate in the completion.',
          zh: '在补全中生成的最大 token 数量。',
        },
      },
      top_p: {
        type: 'number',
        required: false,
        range: '0-1',
        description: {
          en: 'Nucleus sampling parameter. Alternative to temperature.',
          zh: '核采样参数。可作为 temperature 的替代。',
        },
      },
      stream: {
        type: 'boolean',
        required: false,
        default: false,
        description: {
          en: 'Whether to stream partial message deltas. Note: streamCall method should be used for streaming.',
          zh: '是否流式传输部分消息增量。注意：流式传输应使用 streamCall 方法。',
        },
      },
    },
  },
  output: {
    description: {
      en: 'OpenAI Chat Completion response',
      zh: 'OpenAI 聊天补全响应',
    },
    parameters: {
      id: {
        type: 'string',
        description: {
          en: 'Unique identifier for the completion',
          zh: '补全的唯一标识符',
        },
      },
      choices: {
        type: 'array',
        description: {
          en: 'Array of completion choices. Each choice contains message content and finish reason.',
          zh: '补全选项数组。每个选项包含消息内容和完成原因。',
        },
      },
      usage: {
        type: 'object',
        description: {
          en: 'Token usage information including prompt_tokens, completion_tokens, and total_tokens',
          zh: 'Token 使用信息，包括 prompt_tokens、completion_tokens 和 total_tokens',
        },
      },
    },
  },
};
