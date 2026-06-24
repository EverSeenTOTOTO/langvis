import { container, inject, singleton } from 'tsyringe';
import type { AgentBinding } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type { Agent } from '@/server/modules/agent/domain/model/agent.base';
import { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { RuntimeConfigVO } from '@/server/modules/agent/domain/model/runtime-config.vo';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { ToolCallDeps } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import { ToolNotFoundError } from '@/server/modules/agent/domain/errors';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { LlmAdapter } from '@/server/modules/agent/infrastructure/llm.adapter';
import { generateId } from '@/shared/utils';
import { LlmProvider } from '@/server/modules/memory/infrastructure/llm.provider';
import {
  MemoryFactory,
  type MemoryType,
} from '@/server/modules/memory/application/service/memory-factory';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import chalk from 'chalk';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

@singleton()
export class AgentRunExecutor {
  private readonly logger = Logger.child({ source: 'AgentRunExecutor' });

  constructor(
    @inject(LlmProvider) private readonly llmProvider: LlmProvider,
    @inject(MemoryFactory) private readonly memoryFactory: MemoryFactory,
    @inject(CACHE_SERVICE) private readonly cacheService: CachePort,
    @inject(ProviderService) private readonly providerService: ProviderService,
  ) {}

  createRun(params: {
    runId: string;
    workDir: string;
    agentBinding: AgentBinding;
    systemPrompt: string;
    historyMessages: Message[];
  }): { run: AgentRun; ctx: AgentRunContext } {
    const agent = container.resolve<Agent>(params.agentBinding.agentId);

    const cfg = params.agentBinding.config as {
      model?: { modelId?: string };
      memory?: { type?: string; windowSize?: number };
    };
    const modelId = cfg.model?.modelId;
    const memoryType = (cfg.memory?.type ??
      'slide_window_memory') as MemoryType;
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 128_000)
      : 128_000;

    this.logger.info(
      `Create run ${chalk.cyan(params.runId)} — agent: ${chalk.cyan(params.agentBinding.agentId)}, model: ${chalk.red(modelId ?? '(default)')}, memory: ${chalk.red(memoryType)} (${contextSize} ctx)`,
    );

    const config = RuntimeConfigVO.create(
      agent.config,
      params.agentBinding,
      params.systemPrompt,
      contextSize,
    );

    const run = new AgentRun(params.runId, params.agentBinding.agentId, config);

    const memory = this.memoryFactory.create({
      history: params.historyMessages,
      contextSize: config.contextSize,
      modelId: cfg.model?.modelId ?? '',
      memoryType,
      windowSize: cfg.memory?.windowSize,
    });

    const llm = new LlmAdapter(this.llmProvider, modelId);

    const ctx: AgentRunContext = {
      run,
      config,
      agentId: params.agentBinding.agentId,
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
        }),
    };

    return { run, ctx };
  }

  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
  ): AsyncGenerator<EnrichedEvent> {
    const agent = container.resolve<Agent>(run.agentId);
    this.logger.debug(
      `Execute run ${chalk.cyan(run.runId)} for agent ${chalk.cyan(run.agentId)}`,
    );
    yield run.start();

    try {
      for await (const event of agent.call(ctx)) {
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
      this.logger.error(
        `Run ${chalk.cyan(run.runId)} (${run.agentId}) failed: ${err}`,
      );
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
