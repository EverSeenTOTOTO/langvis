import { AgentIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';

export const config: AgentConfig<{
  model?: {
    modelId: string;
    temperature?: number;
    topP?: number;
  };
}> = {
  name: 'Chat Agent',
  description:
    'A conversational agent that engages in natural dialogue with users, maintaining conversation history and context for coherent responses.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            format: 'model-select',
            modelType: 'chat',
          },
          temperature: {
            type: 'number',
            default: 0.7,
            minimum: 0,
            maximum: 1,
            nullable: true,
          },
          topP: {
            type: 'number',
            default: 0.7,
            minimum: 0,
            maximum: 1,
            nullable: true,
          },
        },
        required: ['modelId'],
        nullable: true,
      },
      memory: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['slide_window_memory', 'react_memory'],
            default: 'slide_window_memory',
            // 记忆类型随选中 agent 收窄：ReAct 仅 react_memory，其余仅 slide_window_memory。
            // peer 'agent' 是会话表单里的 agent 选择器（config.agent），不在本 schema 内，
            // 但与 memory 同处 config 根，故按相对根路径 'agent' 引用。
            // 收窄后渲染器会自动清掉不再合法的旧值（见 SchemaField 的 ReactiveEnumGuard）。
            reactions: [
              {
                when: { field: 'agent', op: 'eq', value: AgentIds.REACT },
                set: { enum: ['react_memory'] },
              },
              {
                when: { field: 'agent', op: 'ne', value: AgentIds.REACT },
                set: { enum: ['slide_window_memory'] },
              },
            ],
          },
          windowSize: {
            type: 'integer',
            minimum: 1,
            default: 10,
            description: 'Number of conversation turns to keep in memory',
            // 仅滑动窗口记忆需要 windowSize；react_memory 不用它 → 隐藏。
            // peer 路径相对 configSchema 根（顶层 properties），故为 'memory.type'。
            reactions: [
              {
                when: {
                  field: 'memory.type',
                  op: 'ne',
                  value: 'slide_window_memory',
                },
                set: { visible: false },
              },
            ],
          },
        },
      },
      upload: {
        type: 'object',
        properties: {
          maxSize: {
            type: 'number',
            description: 'Maximum file size in bytes (e.g. 10485760 = 10MB)',
            default: 10485760,
            nullable: true,
          },
          allowedTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed MIME types (e.g. image/*, application/pdf)',
            default: ['image/*', 'application/pdf', 'text/*'],
            nullable: true,
          },
          maxCount: {
            type: 'number',
            description: 'Maximum number of files per upload',
            default: 5,
            nullable: true,
          },
        },
        nullable: true,
      },
    },
  },
};
