import { container, inject, singleton } from 'tsyringe';
import type { Message } from '@/shared/types/entities';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { LlmAdapter } from '@/server/modules/agent/infrastructure/llm.adapter';
import { generateId } from '@/shared/utils';
import { LlmProvider } from '@/server/modules/memory/infrastructure/llm.provider';
import { ConversationMemory } from '@/server/modules/memory/domain/model/conversation-memory';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { ToolService } from './tool.service';
import { AgentService } from './agent.service';
import { runReactLoop } from './react-loop';
import Logger from '@/server/utils/logger';
import chalk from 'chalk';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

@singleton()
export class AgentRunExecutor {
  private readonly logger = Logger.child({ source: 'AgentRunExecutor' });

  constructor(
    @inject(LlmProvider) private readonly llmProvider: LlmProvider,
    @inject(CACHE_SERVICE) private readonly cacheService: CachePort,
    @inject(ProviderService) private readonly providerService: ProviderService,
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(AgentService) private readonly agentService: AgentService,
  ) {}

  createRun(params: {
    runId: string;
    workDir: string;
    userConfig: Record<string, unknown>;
    systemPrompt: string;
    historyMessages: Message[];
  }): { run: AgentRun; ctx: AgentRunContext } {
    const cfg = params.userConfig as {
      model?: { modelId?: string };
    };
    const modelId = cfg.model?.modelId;
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 128_000)
      : 128_000;

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — model: ${chalk.red(modelId ?? '(default)')} (${contextSize} ctx)`,
    );

    const config = this.agentService.createRunConfig(
      params.userConfig,
      params.systemPrompt,
      contextSize,
    );

    const run = new AgentRun(params.runId, config);

    const memory = new ConversationMemory({
      history: params.historyMessages,
      contextSize: config.contextSize,
      modelId: cfg.model?.modelId ?? '',
    });

    const llm = new LlmAdapter(this.llmProvider, modelId);

    const ctx: AgentRunContext = {
      run,
      config,
      runId: run.runId,
      workDir: params.workDir,
      signal: run.signal,
      llm,
      cache: this.cacheService,
      memory,
      executeTool: (toolName, args) =>
        this.executeTool(toolName, args, {
          signal: run.signal,
          workDir: params.workDir,
          runId: run.runId,
          llm,
          cache: this.cacheService,
          runtimeConfig: config.runtimeConfig,
        }),
    };

    return { run, ctx };
  }

  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
  ): AsyncGenerator<EnrichedEvent> {
    // 确保工具已注册（原 AgentService 构造时触发的初始化，现由执行器保证）。
    await this.toolService.initialize();

    this.logger.debug(`Execute run ${chalk.cyan(run.runId)}`);
    yield run.start();

    try {
      for await (const event of runReactLoop(ctx)) {
        const enriched = run.append(event);
        if (enriched) yield enriched;
      }

      if (!run.isTerminated) {
        const { used, total } = ctx.memory.getContextUsage();
        const usage = run.append({
          type: 'context_usage',
          used,
          total,
          reason: 'turn_completed',
        });
        if (usage) yield usage;
        yield run.complete();
      }
    } catch (err) {
      if (ctx.signal.aborted || run.isTerminated) return;
      this.logger.error(`Run ${chalk.cyan(run.runId)} failed: ${err}`);
      yield run.fail((err as Error)?.message ?? String(err));
    }
  }

  /** 取消：run.cancel 原子地 abort + 记录 cancelled 事件，返回富化事件供调用方推送 SSE */
  cancel(run: AgentRun, reason: string): EnrichedEvent | null {
    return run.cancel(reason);
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
