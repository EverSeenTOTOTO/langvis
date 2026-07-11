import { container, inject, singleton } from 'tsyringe';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type {
  AgentRunContext,
  ToolExecutor,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { generateId } from '@/shared/utils';
import { ToolIds } from '@/shared/constants';
import type { LlmMessage } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/libs/config';
import { ListMonad } from '@/server/libs/list';
import { HookPlan } from '@/server/modules/agent/domain/model/hook';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import { AgentService } from './agent.service';
import { runReactLoop } from './react-loop';
import Logger from '@/server/utils/logger';
import chalk from 'chalk';
import {
  AGENT_RUN_REPOSITORY,
  CACHE_PORT,
} from '@/server/modules/agent/agent.di-tokens';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

/** 对话无关的 run 启动参数——conv 与子 agent 都用它驱动 Launcher。 */
export interface LaunchParams {
  runId: string;
  workDir: string;
  /** conv 侧一次性 parse 的运行时配置（agent 直接复用，不再二次 parse）。contextSize 按需派生，不在此处。 */
  runtimeConfig: ConversationConfig;
  /** run 初始消息；conv 直传 effectiveHistory（ReAct 还原在 createRun），子 agent 由 brief+query 派生。 */
  seed: LlmMessage[];
  /** 该 run 的有界工具集——executeTool 仅允许集合内成员。conv 传全集，子 agent 传 parent.without(...)。 */
  toolSet: ToolSet;
  /** 是否允许 HITL。conv run = true；子 agent = false（无 HTTP 提交入口）。 */
  interactive: boolean;
  /** 父 run 的取消信号（子 agent 用）；父 abort 时传播并 cancel 本 run。conv run 不传。 */
  parentSignal?: AbortSignal;
}

@singleton()
export class AgentRunExecutor {
  private readonly logger = Logger.child({ source: 'AgentRunExecutor' });
  /** 活跃 run 注册表——cancel(runId) 据此找到内存中的 AgentRun。 */
  private readonly activeRuns = new Map<string, AgentRun>();

  constructor(
    @inject(LLM_PORT) private readonly llm: LlmPort,
    @inject(CACHE_PORT) private readonly cache: CachePort,
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
    @inject(AgentService) private readonly agentService: AgentService,
  ) {}

  createRun(params: LaunchParams): {
    run: AgentRun;
    ctx: AgentRunContext;
    runTool: ToolExecutor;
  } {
    const { runtimeConfig } = params;
    const modelId = runtimeConfig.model?.modelId;

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — model: ${chalk.red(modelId ?? '(default)')}`,
    );

    const config = this.agentService.buildResolvedRunConfig(runtimeConfig);

    const run = new AgentRun(params.runId, config);

    const ctx: AgentRunContext = {
      run,
      config,
      runId: run.runId,
      workDir: params.workDir,
      signal: run.signal,
      llm: this.llm,
      cache: this.cache,
      messages: ListMonad.of(params.seed).map(restoreReactMessage),
      base: params.seed.length,
      hooks: new HookPlan(resolveAgentHooks()),
      interactive: params.interactive,
    };

    return {
      run,
      ctx,
      runTool: (toolName, args) =>
        this.executeTool(ctx, toolName, args, params.toolSet),
    };
  }

  async *launch(params: LaunchParams): AsyncGenerator<EnrichedEvent> {
    const { run, ctx, runTool } = this.createRun(params);

    // 父取消传播到子 run：父信号 abort 即 cancel 本 run（仅子 agent 场景需要）。
    if (params.parentSignal) {
      if (params.parentSignal.aborted) run.cancel('parent aborted');
      else
        params.parentSignal.addEventListener('abort', () =>
          run.cancel('parent aborted'),
        );
    }

    await this.agentRunRepo.save({
      id: run.runId,
      status: 'running',
      events: [],
      config: {
        tools: run.config.tools,
        runtimeConfig: run.config.runtimeConfig,
      },
      startedAt: new Date(),
      completedAt: null,
      processSummary: null,
    });
    this.activeRuns.set(run.runId, run);

    try {
      yield* this.execute(run, ctx, runTool);
    } finally {
      this.activeRuns.delete(run.runId);
      await this.agentRunRepo.update(run.runId, {
        events: [...run.eventStream],
        status: run.currentStatus,
        completedAt: new Date(),
        processSummary: run.processSummary,
      });
    }
  }

  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
    runTool: ToolExecutor,
  ): AsyncGenerator<EnrichedEvent> {
    this.logger.debug(`Execute run ${chalk.cyan(run.runId)}`);
    if (!run.isTerminated) yield run.start();

    try {
      for await (const event of runReactLoop(ctx, runTool)) {
        const enriched = run.append(event);
        if (enriched) yield enriched;
      }

      if (!run.isTerminated) {
        yield run.complete();
      }
    } catch (err) {
      if (ctx.signal.aborted || run.isTerminated) return;
      this.logger.error(`Run ${chalk.cyan(run.runId)} failed: ${err}`);
      yield run.fail((err as Error)?.message ?? String(err));
    }
  }

  cancel(runId: string, reason: string): EnrichedEvent | null {
    const run = this.activeRuns.get(runId);
    return run?.cancel(reason) ?? null;
  }

  /** 取活跃 run（内存中）——CRUD 实时进度读取用；不存在则 undefined（调用方回落到 repo）。 */
  getActiveRun(runId: string): AgentRun | undefined {
    return this.activeRuns.get(runId);
  }

  private executeTool(
    ctx: AgentRunContext,
    toolName: string,
    args: Record<string, unknown>,
    toolSet: ToolSet,
  ): AsyncGenerator<RunEvent, string, void> {
    if (!toolSet.has(toolName)) throw new ToolNotFoundError(toolName);
    let tool: Tool;
    try {
      tool = container.resolve<Tool>(toolName);
    } catch {
      throw new ToolNotFoundError(toolName);
    }

    const toolCall = new ToolCall(generateId('tc'), tool, args, ctx);

    return toolCall.execute();
  }
}

/** assistant 文本 → response_user JSON；msg.summary 注入为 thought。 */
export function restoreReactMessage(m: LlmMessage): LlmMessage {
  return m.role === 'assistant'
    ? {
        role: 'assistant' as const,
        content: JSON.stringify({
          ...(m.summary ? { thought: m.summary } : {}),
          tool: ToolIds.RESPONSE_USER,
          input: { message: m.content },
        }),
      }
    : { role: m.role, content: m.content };
}
