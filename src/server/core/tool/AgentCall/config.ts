import { ToolConfig } from '@/shared/types';

export interface AgentCallInput {
  agentId: string;
  /** Background context for the child agent */
  context?: string;
  /** The task/query for the child agent to execute */
  query: string;
  config?: {
    timeout?: number;
  };
}

export interface AgentCallOutput {
  success: boolean;
  content?: string;
  error?: string;
}

export const config: ToolConfig<AgentCallInput, AgentCallOutput> = {
  name: 'agent_call',
  description: '调用其他 Agent 执行子任务。',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: '目标 Agent ID',
      },
      context: {
        type: 'string',
        description: '背景信息，传递给子 agent 作为上下文',
        nullable: true,
      },
      query: {
        type: 'string',
        description: '需要子 agent 执行的任务',
      },
      config: {
        type: 'object',
        properties: {
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 60000',
            nullable: true,
          },
        },
        nullable: true,
      },
    },
    required: ['agentId', 'query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        description: '执行是否成功',
      },
      content: {
        type: 'string',
        nullable: true,
        description: '子 Agent 累积的最终内容',
      },
      error: {
        type: 'string',
        nullable: true,
        description: '错误信息',
      },
    },
    required: ['success'],
  },
  skipCompression: true,
};
