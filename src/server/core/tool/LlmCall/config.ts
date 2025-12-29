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
    model: {
      type: 'text',
      required: false,
      description: {
        en: 'The model to use for completion. Defaults to OPENAI_MODEL environment variable if not specified.',
        zh: '用于补全的模型。如果未指定，默认使用 OPENAI_MODEL 环境变量。',
      },
    },
    temperature: {
      type: 'number',
      required: false,
      min: 0,
      max: 2,
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
      min: 0,
      max: 1,
      description: {
        en: 'Nucleus sampling parameter. Alternative to temperature.',
        zh: '核采样参数。可作为 temperature 的替代。',
      },
    },
    stream: {
      type: 'switch',
      required: false,
      initialValue: false,
      description: {
        en: 'Whether to stream partial message deltas. Note: streamCall method should be used for streaming.',
        zh: '是否流式传输部分消息增量。注意：流式传输应使用 streamCall 方法。',
      },
    },
  },
  output: {},
};
