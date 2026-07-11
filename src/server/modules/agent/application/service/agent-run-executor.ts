import { container, inject, singleton } from 'tsyringe';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { generateId } from '@/shared/utils';
import type { LlmMessage } from '@/shared/types/entities';
import { ListMonad } from '@/server/libs/list';
import { HookPlan } from '@/server/modules/agent/domain/model/hook';
import { resolveAgentHooks } from '@/server/modules/agent/application/hooks';
import type { ConversationConfig } from '@/server/modules/conversation/contracts';
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
  /** conv 侧一次性解析的会话配置（contextSize + runtimeConfig）；agent 直接复用，不再二次 parse/resolveChatModel。 */
  config: ConversationConfig;
  systemPrompt: string;
  /** run 的初始消息（已含 system 提示）；conv 由 effectiveHistory 经 buildIterMessages 派生，子 agent 由 brief+query 派生。 */
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

  createRun(params: LaunchParams): { run: AgentRun; ctx: AgentRunContext } {
    const { contextSize, runtimeConfig } = params.config;
    const modelId = (runtimeConfig as { model?: { modelId?: string } }).model
      ?.modelId;

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — model: ${chalk.red(modelId ?? '(default)')} (${contextSize} ctx)`,
    );

    const config = this.agentService.buildResolvedRunConfig(
      params.systemPrompt,
      contextSize,
      runtimeConfig,
    );

    const run = new AgentRun(params.runId, config);

    const ctx: AgentRunContext = {
      run,
      config,
      runId: run.runId,
      workDir: params.workDir,
      signal: run.signal,
      llm: this.llm,
      cache: this.cache,
      messages: ListMonad.of(params.seed),
      base: params.seed.length,
      hooks: new HookPlan(resolveAgentHooks()),
      executeTool: (toolName, args) =>
        this.executeTool(toolName, args, params.toolSet, {
          signal: run.signal,
          workDir: params.workDir,
          runId: run.runId,
          interactive: params.interactive,
          llm: this.llm,
          cache: this.cache,
          chatModelId: modelId,
          runtimeConfig: config.runtimeConfig,
          contextSize: config.contextSize,
        }),
    };

    return { run, ctx };
  }

  async *launch(params: LaunchParams): AsyncGenerator<EnrichedEvent> {
    const { run, ctx } = this.createRun(params);

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
        systemPrompt: run.config.systemPrompt,
        tools: run.config.tools,
        contextSize: run.config.contextSize,
        runtimeConfig: run.config.runtimeConfig,
      },
      startedAt: new Date(),
      completedAt: null,
      processSummary: null,
    });
    this.activeRuns.set(run.runId, run);

    try {
      yield* this.execute(run, ctx);
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
  ): AsyncGenerator<EnrichedEvent> {
    this.logger.debug(`Execute run ${chalk.cyan(run.runId)}`);
    if (!run.isTerminated) yield run.start();

    try {
      for await (const event of runReactLoop(ctx)) {
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
    toolName: string,
    args: Record<string, unknown>,
    toolSet: ToolSet,
    deps: ToolCallDeps,
  ): AsyncGenerator<RunEvent, string, void> {
    if (!toolSet.has(toolName)) throw new ToolNotFoundError(toolName);
    let tool: Tool;
    try {
      tool = container.resolve<Tool>(toolName);
    } catch {
      throw new ToolNotFoundError(toolName);
    }

    const toolCall = new ToolCall(
      generateId('tc'),
      tool,
      args,
      deps.cache,
      deps,
    );

    return toolCall.execute();
  }
}
