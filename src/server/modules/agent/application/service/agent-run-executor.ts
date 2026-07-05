import { container, inject, singleton } from 'tsyringe';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { generateId } from '@/shared/utils';
import { ToolIds } from '@/shared/constants';
import type { LlmMessage } from '@/shared/types/entities';
import { WorkingMemory } from '@/server/modules/agent/domain/model/working-memory';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { ToolService } from './tool.service';
import { AgentService } from './agent.service';
import { runReactLoop } from './react-loop';
import Logger from '@/server/utils/logger';
import chalk from 'chalk';
import {
  AGENT_RUN_REPOSITORY,
  CACHE_PORT,
} from '@/server/modules/agent/agent.di-tokens';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

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
    @inject(ProviderService) private readonly providerService: ProviderService,
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(AgentService) private readonly agentService: AgentService,
  ) {}

  createRun(params: {
    runId: string;
    workDir: string;
    userConfig: Record<string, unknown>;
    systemPrompt: string;
    /** conv 提供的有效历史（LLM-ready）；agent 据此格式化 WorkingMemory 种子。 */
    effectiveHistory: LlmMessage[];
  }): { run: AgentRun; ctx: AgentRunContext } {
    const cfg = params.userConfig as {
      model?: { modelId?: string };
    };
    const { id: modelId, contextSize } = this.providerService.resolveChatModel(
      cfg.model?.modelId,
    );

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — model: ${chalk.red(modelId ?? '(default)')} (${contextSize} ctx)`,
    );

    const config = this.agentService.createRunConfig(
      params.userConfig,
      params.systemPrompt,
      contextSize,
    );

    const run = new AgentRun(params.runId, config);

    const workingMemory = new WorkingMemory({
      seed: buildIterMessages(params.effectiveHistory),
      contextSize: config.contextSize,
      runtimeConfig: config.runtimeConfig,
    });

    const ctx: AgentRunContext = {
      run,
      config,
      runId: run.runId,
      workDir: params.workDir,
      signal: run.signal,
      llm: this.llm,
      cache: this.cache,
      workingMemory,
      executeTool: (toolName, args) =>
        this.executeTool(toolName, args, {
          signal: run.signal,
          workDir: params.workDir,
          runId: run.runId,
          llm: this.llm,
          cache: this.cache,
          chatModelId: modelId,
          runtimeConfig: config.runtimeConfig,
        }),
    };

    return { run, ctx };
  }

  async *run(params: {
    runId: string;
    workDir: string;
    userConfig: Record<string, unknown>;
    systemPrompt: string;
    effectiveHistory: LlmMessage[];
  }): AsyncGenerator<EnrichedEvent> {
    const { run, ctx } = this.createRun(params);

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
      });
    }
  }

  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
  ): AsyncGenerator<EnrichedEvent> {
    // 工具注册现由执行器保证（原 AgentService 构造时触发）。
    await this.toolService.initialize();

    this.logger.debug(`Execute run ${chalk.cyan(run.runId)}`);
    yield run.start();

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

  private executeTool(
    toolName: string,
    args: Record<string, unknown>,
    deps: ToolCallDeps,
  ): AsyncGenerator<RunEvent, string, void> {
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

/** 历史回复重建为扁平的 response_user 调用，保持与当前输出格式一致（agent 拥有的种子格式）。 */
function buildIterMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.map(msg =>
    msg.role === 'assistant'
      ? {
          role: 'assistant' as const,
          content: JSON.stringify({
            tool: ToolIds.RESPONSE_USER,
            input: { message: msg.content },
          }),
        }
      : { role: msg.role, content: msg.content },
  );
}
