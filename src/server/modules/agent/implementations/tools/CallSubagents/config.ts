import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface CallSubagentsChild {
  /** 主 agent 总结后的背景/上下文，作为该子 agent 的任务背景。 */
  brief: string;
  /** 该子 agent 的具体任务。 */
  query: string;
}

export interface CallSubagentsInput {
  children: CallSubagentsChild[];
}

export interface ChildRunResult {
  runId: string;
  status: string;
  /** 子 agent 终态 response_user 的 message（成功时）。 */
  response?: string;
}

export interface CallSubagentsOutput {
  results: ChildRunResult[];
}

export const config: ToolConfig<CallSubagentsInput, CallSubagentsOutput> = {
  name: 'call_subagents',
  description:
    '并发派生多个子 agent 处理可拆分的独立子任务。每个子 agent 将拥有独立、隔离的 ReAct 循环：以 brief 为背景、query 为任务自行完成。**等全部子 agent 结束（allSettled，成功或失败各自独立）后返回**，收集各自的最终回复。仅当任务能拆成彼此独立、适合并行隔离执行的子任务时使用；不要用于有依赖顺序的步骤。',
  inputSchema: {
    type: 'object',
    properties: {
      children: {
        type: 'array',
        description: '要派生的子 agent 列表，彼此并发执行。',
        items: {
          type: 'object',
          properties: {
            brief: {
              type: 'string',
              description:
                '传给该子 agent 的、主 agent 总结后的背景/上下文（如整体目标、共享约束、管线规则）。',
            },
            query: {
              type: 'string',
              description: '该子 agent 的具体任务（如「查阅 X to Y 机票」）。',
            },
          },
          required: ['brief', 'query'],
        },
      },
    },
    required: ['children'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: '每个子 agent 的终态。',
        items: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              description: '子 agent 的 runId（可查进度）',
            },
            status: {
              type: 'string',
              description: 'completed | failed | cancelled',
            },
            response: {
              type: 'string',
              description: '子 agent 的最终回复（成功时）。',
              nullable: true,
            },
          },
          required: ['runId', 'status'],
        },
      },
    },
    required: ['results'],
  },
};

export const id = ToolIds.CALL_SUBAGENTS;
