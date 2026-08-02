import { tool } from '@/server/decorator/tool';
import { inject } from 'tsyringe';
import type { Logger } from '@/server/utils/logger';
import rootLogger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';

const logger = rootLogger.child({ source: 'CallSubagentsTool' });
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { generateId } from '@/shared/utils';
import { mergeGenerators } from '@/server/utils/mergeGenerators';
import {
  AgentRunExecutor,
  type LaunchParams,
} from '@/server/modules/agent/application/service/agent-run-executor';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { SUBAGENT_PROMPT } from '@/server/modules/agent/application/service/base-prompt';
import type {
  CallSubagentsInput,
  CallSubagentsOutput,
  ChildRunResult,
} from './config';

// CallSubagents —— 主 agent 并发派生对话无关的子 run（经 Launcher），全部结束后 allSettled 收集终态。
// 子 ToolSet = 默认全集 ∖ {call_subagents, ask_user}：禁嵌套、禁 HITL。
@tool(ToolIds.CALL_SUBAGENTS)
export default class CallSubagentsTool extends Tool<CallSubagentsOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(AgentRunExecutor) private readonly executor: AgentRunExecutor,
    @inject(AgentService) private readonly agentService: AgentService,
  ) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, CallSubagentsOutput, void> {
    ctx.signal.throwIfAborted();

    const { children } = ctx.input as unknown as CallSubagentsInput;
    logger.info(`subagents fan-out: ${children.length} child run(s)`);

    const childToolSet = this.agentService.buildToolSet([
      ToolIds.CALL_SUBAGENTS,
      ToolIds.ASK_USER,
    ]);
    const basePrompt = this.agentService.buildSystemPrompt(
      childToolSet,
      SUBAGENT_PROMPT,
    );

    const plans = children.map(spec => ({ spec, runId: generateId('run') }));

    const launches = plans.map(({ spec, runId }) => {
      const systemPrompt = `${basePrompt}\n\n## 任务背景\n${spec.brief}`;
      const params: LaunchParams = {
        runId,
        workDir: ctx.workDir,
        conversationId: ctx.conversationId,
        runtimeConfig: ctx.runtimeConfig,
        seed: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: spec.query },
        ],
        toolSet: childToolSet,
        interactive: false,
        parentSignal: ctx.signal,
      };
      return this.executor.launch(params);
    });

    // 每子一次性通报 { childRunId, brief, query }：带 childRunId，projectRun 既有
    // 规则即保留，前端无需读父 toolArgs、无需 runId↔index 映射。
    for (const { spec, runId } of plans) {
      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: { childRunId: runId, brief: spec.brief, query: spec.query },
      };
    }

    // 收集每个 child 的终态（按 runId）。
    const results = new Map<string, ChildRunResult>();
    const ensure = (runId: string): ChildRunResult => {
      let r = results.get(runId);
      if (!r) {
        r = { runId, status: 'running' };
        results.set(runId, r);
      }
      return r;
    };

    // 并发汇流：任一 child 有事件就向父 run 汇报（tool_progress，projectRun 不计入步骤）。
    for await (const event of mergeGenerators(launches)) {
      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: { childRunId: event.runId, event },
      };

      if (
        event.type === 'tool_call' &&
        event.toolName === ToolIds.RESPONSE_USER
      ) {
        ensure(event.runId).response = String(
          (event.toolArgs as { message?: unknown }).message ?? '',
        );
      } else if (event.type === 'final') {
        ensure(event.runId).status = 'completed';
      } else if (event.type === 'error') {
        ensure(event.runId).status = 'failed';
      } else if (event.type === 'cancelled') {
        ensure(event.runId).status = 'cancelled';
      }
    }

    const byStatus = [...results.values()].reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    logger.info(`subagents done: ${results.size} child run(s)`, byStatus);

    return { results: [...results.values()] };
  }
}
