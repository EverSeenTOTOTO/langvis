import { tool } from '@/server/decorator/core';
import { inject } from 'tsyringe';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { generateId } from '@/shared/utils';
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

/**
 * CallSubagents —— 主 agent 并发派生子 agent 的工具。
 *
 * 每个子 agent 是一次完整的、对话无关的 run（经 Launcher 启动）：自己的 ReAct 循环、自己的
 * WorkingMemory、跑到 response_user 终态。子事件以父级 tool_progress 转发（不污染父步骤投影），
 * 全部结束后（allSettled）收集各子终态返回。
 *
 * 子 ToolSet = 默认全集 ∖ {call_subagents, ask_user}：禁嵌套、禁 HITL（HITL 以 runId 为键，
 * 子 run 无对应 HTTP 入口会死锁）。
 */
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
        userConfig: ctx.runtimeConfig,
        systemPrompt,
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

    return { results: [...results.values()] };
  }
}

/**
 * 并发汇流多个 AsyncGenerator：任一产出即转发，全部结束后收尾。单条流抛错不影响其它
 * （allSettled 语义）。事件按到达顺序交错转发，保证父 run 能近实时看到各 child 进展。
 */
async function* mergeGenerators<T>(
  gens: readonly AsyncGenerator<T>[],
): AsyncGenerator<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let active = gens.length;

  const tasks = gens.map(async gen => {
    try {
      for await (const item of gen) {
        queue.push(item);
        wake?.();
        wake = null;
      }
    } catch {
      // 单条流失败不击垮汇流——allSettled。
    } finally {
      active -= 1;
      wake?.();
      wake = null;
    }
  });

  while (active > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    }
    while (queue.length > 0) yield queue.shift() as T;
  }

  await Promise.allSettled(tasks);
}
