import { ModuleRef } from '@nestjs/core';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Hook } from '@/server/modules/agent/domain/model/hook';
import type {
  AgentRunContext,
  ToolExecutor,
  ToolRunResult,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import {
  AgentRunConcurrentModificationError,
  ToolNotFoundError,
} from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import type { LlmPort } from '@/server/shared/ports/llm/llm.port';
import { LLM_PORT } from '@/server/shared/ports/llm/llm.tokens';
import { generateId } from '@/shared/utils';
import { TraceContext } from '@/server/middleware/trace-context';
import type { LlmMessage } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';
import { HookPlan } from '@/server/modules/agent/domain/model/hook';
import { HOOK_TYPES } from '@/server/modules/agent/application/hooks/registry';
import { AgentService } from './agent.service';
import { restoreReactMessage } from './react-message';
import { runReactLoop } from './react-loop';
import { ToolLatencyTracker } from './tool-latency-tracker';
import Logger from '@/server/utils/logger';
import { traceGen } from '@/server/otel';
import { SpanStatusCode } from '@opentelemetry/api';
import chalk from 'chalk';
import {
  AGENT_RUN_REPOSITORY,
  CACHE_PORT,
  AUTHORIZATION_PORT,
} from '@/server/modules/agent/agent.di-tokens';
import type { AuthorizationPort } from '@/server/modules/agent/domain/port/authorization.port';
import { Inject } from '@nestjs/common';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

/** 终态乐观锁提交的最大重试次数。commit 每次重读最新版本，重试几乎必然成功。 */
const FINALIZE_MAX_RETRIES = 2;

/** 每累积这么多非终态事件，就 checkpoint 一次事件流快照（崩溃恢复投影依赖它）。 */
const CHECKPOINT_EVERY = 50;

/** 对话无关的 run 启动参数——conv 与子 agent 都用它驱动 Launcher。 */
export interface LaunchParams {
  runId: string;
  workDir: string;
  /** 会话句柄：授权 grant 按 conversationId 持久（workDir 文件），跨 run 复用。 */
  conversationId: string;
  /** conv 侧一次性 parse 的运行时配置（agent 直接复用，不再二次 parse）。contextSize 按需派生，不在此处。 */
  runtimeConfig: ConversationConfig;
  /** run 初始消息；conv 直传 effectiveHistory */
  seed: LlmMessage[];
  /** 该 run 的有界工具集——executeTool 仅允许集合内成员。conv 传全集，子 agent 传 parent.without(...) 子集。 */
  toolSet: ToolSet;
  /** 是否允许 HITL。conv run = true；子 agent = false。 */
  interactive: boolean;
  /** 父 run 的取消信号（子 agent 用）；父 abort 时传播并 cancel 本 run。 */
  parentSignal?: AbortSignal;
}

export class AgentRunExecutor {
  private readonly logger = Logger.child({ source: 'AgentRunExecutor' });
  /** 活跃 run 注册表——cancel(runId) 据此找到内存中的 AgentRun。 */
  private readonly activeRuns = new Map<string, AgentRun>();
  /** 每 N 个非终态事件 checkpoint 一次；测试可覆盖调小。 */
  checkpointEvery = CHECKPOINT_EVERY;

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(AUTHORIZATION_PORT) private readonly auth: AuthorizationPort,
    @Inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
    @Inject(AgentService) private readonly agentService: AgentService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  async createRun(params: LaunchParams): Promise<{
    run: AgentRun;
    ctx: AgentRunContext;
    runTool: ToolExecutor;
  }> {
    const { runtimeConfig } = params;
    const modelId = runtimeConfig.model?.modelId;

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — model: ${chalk.yellowBright(modelId ?? '(default)')}`,
    );

    const config = this.agentService.buildResolvedRunConfig(runtimeConfig);

    const run = new AgentRun(params.runId, config);

    const ctx: AgentRunContext = {
      run,
      config,
      runId: run.runId,
      workDir: params.workDir,
      conversationId: params.conversationId,
      signal: run.signal,
      llm: this.llm,
      cache: this.cache,
      auth: this.auth,
      messages: params.seed.map(restoreReactMessage),
      base: params.seed.length,
      // per-run 瞬态：TRANSIENT providers 经 ModuleRef.resolve 每次 promise 新建
      hooks: new HookPlan(await this.resolveHooks()),
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
    const { run, ctx, runTool } = await this.createRun(params);

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
    });
    this.activeRuns.set(run.runId, run);

    try {
      yield* this.execute(run, ctx, runTool);
    } finally {
      this.activeRuns.delete(run.runId);
      await this.persistFinal(run);
    }
  }

  // 乐观锁写环（checkpoint + 终态共用）：冲突（另一 writer 已改版本）就重读重试——commit/checkpoint 每次重读最新版本，重试几乎必然成功；仍冲突记错不静默覆盖。
  private async withVersionRetry(
    run: AgentRun,
    write: () => Promise<boolean>,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < FINALIZE_MAX_RETRIES; attempt++) {
      try {
        if (await write()) return true;
        this.logger.warn(`Run ${run.runId} write: row missing, skipped`);
        return false;
      } catch (err) {
        if (!(err instanceof AgentRunConcurrentModificationError)) throw err;
        this.logger.warn(
          `Run ${run.runId} write conflicted with concurrent writer, retrying (${attempt + 1}/${FINALIZE_MAX_RETRIES})`,
        );
      }
    }
    return false;
  }

  /** 乐观锁终态提交：events 是本事件流的唯一权威 writer。 */
  private async persistFinal(run: AgentRun): Promise<void> {
    const params = {
      events: [...run.eventStream],
      status: run.currentStatus,
      completedAt: new Date(),
    };
    const saved = await this.withVersionRetry(run, () =>
      this.agentRunRepo.commit(run.runId, params).then(r => r !== null),
    );
    if (!saved) {
      this.logger.error(
        `Run ${run.runId} finalize abandoned after ${FINALIZE_MAX_RETRIES} attempts — not persisted`,
        { status: params.status, eventCount: params.events.length },
      );
    }
  }

  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
    runTool: ToolExecutor,
  ): AsyncGenerator<EnrichedEvent> {
    if (TraceContext.get()) TraceContext.update({ runId: run.runId });
    const startedAt = Date.now();
    const tracker = new ToolLatencyTracker(this.logger);
    if (!run.isTerminated) yield run.start();

    yield* traceGen(
      'agent.run',
      {
        'run.id': run.runId,
        'conversation.id': ctx.conversationId,
        'model.id': ctx.config.runtimeConfig.model?.modelId ?? 'default',
      },
      span =>
        async function* (this: AgentRunExecutor) {
          try {
            for await (const event of runReactLoop(ctx, runTool)) {
              const enriched = run.append(event);
              if (!enriched) continue;
              tracker.observe(enriched);
              await this.maybeCheckpoint(run);
              yield enriched;
            }

            if (!run.isTerminated) {
              yield run.complete();
            }
          } catch (err) {
            // abort / 已终态：控制流退出不标记 span 异常。
            if (ctx.signal.aborted || run.isTerminated) return;
            span.recordException(err as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (err as Error)?.message ?? String(err),
            });
            this.logger.error(`Run ${chalk.cyan(run.runId)} failed: ${err}`);
            yield run.fail((err as Error)?.message ?? String(err));
          } finally {
            span.setAttribute('run.status', run.currentStatus);
            span.setAttribute('run.iterations', tracker.iterations);
            span.setAttribute('run.duration_ms', Date.now() - startedAt);
            this.logger.info(
              `Run ${chalk.cyan(run.runId)} → ${run.currentStatus}`,
              {
                status: run.currentStatus,
                iterations: tracker.iterations,
                durationMs: Date.now() - startedAt,
                model: ctx.config.runtimeConfig.model?.modelId,
              },
            );
          }
        }.call(this),
    );
  }

  /** 中途 checkpoint：事件流单调增长，每 N 个非终态事件落一次快照；冲突重读重试。 */
  private async maybeCheckpoint(run: AgentRun): Promise<void> {
    if (run.isTerminated || run.eventStream.length === 0) return;
    if (run.eventStream.length % this.checkpointEvery !== 0) return;
    await this.withVersionRetry(run, () =>
      this.agentRunRepo
        .checkpoint(run.runId, [...run.eventStream])
        .then(r => r !== null),
    );
  }

  cancel(runId: string, reason: string): EnrichedEvent | null {
    const run = this.activeRuns.get(runId);
    return run?.cancel(reason) ?? null;
  }

  /** 取活跃 run（内存中）——CRUD 实时进度读取用；不存在则 undefined（调用方回落到 repo）。 */
  getActiveRun(runId: string): AgentRun | undefined {
    return this.activeRuns.get(runId);
  }

  /** per-run 瞬态 hooks：resolve 对 TRANSIENT 每次新建（get 不支持 scoped provider）。 */
  private resolveHooks(): Promise<Hook[]> {
    return Promise.all(HOOK_TYPES.map(T => this.moduleRef.resolve(T)));
  }

  private executeTool(
    ctx: AgentRunContext,
    toolName: string,
    args: Record<string, unknown>,
    toolSet: ToolSet,
  ): AsyncGenerator<RunEvent, ToolRunResult, void> {
    if (!toolSet.has(toolName)) throw new ToolNotFoundError(toolName);
    let tool: Tool;
    try {
      tool = this.moduleRef.get<Tool>(toolName, { strict: false });
    } catch {
      throw new ToolNotFoundError(toolName);
    }

    const toolCall = new ToolCall(generateId('tc'), tool, args, ctx);

    return toolCall.execute();
  }
}
