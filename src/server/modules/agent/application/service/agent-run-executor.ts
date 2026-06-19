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
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';

/**
 * AgentRunExecutor — 执行编排（application service）。
 *
 * 吸收旧 AgentRun 聚合根上的全部 god 职责：
 *  - 解析依赖（agent / memory / llm / cache）
 *  - 拥有 AbortController（取消控制）
 *  - 富化事件（注入 runId/seq/at）
 *  - 驱动 agent.call(ctx)，把 yield 的事实 append 进 run + yield 给传输
 *
 * 聚合根（AgentRun）只记录事实，投影（projectRun）只读，传输（SSE 桥）只推。
 */
@singleton()
export class AgentRunExecutor {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    @inject(LlmProvider) private readonly llmProvider: LlmProvider,
    @inject(MemoryFactory) private readonly memoryFactory: MemoryFactory,
    @inject(CACHE_SERVICE) private readonly cacheService: CachePort,
    @inject(ProviderService) private readonly providerService: ProviderService,
  ) {}

  createRun(params: {
    runId: string;
    messageId: string;
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
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 128_000)
      : 128_000;

    const config = RuntimeConfigVO.create(
      agent.config,
      params.agentBinding,
      params.systemPrompt,
      contextSize,
    );

    const run = new AgentRun(params.runId, params.agentBinding.agentId, config);

    const memory = this.memoryFactory.create({
      history: params.historyMessages,
      systemPrompt: config.systemPrompt,
      contextSize: config.contextSize,
      modelId: cfg.model?.modelId ?? '',
      memoryType: (cfg.memory?.type ?? 'slide_window_memory') as MemoryType,
      windowSize: cfg.memory?.windowSize,
    });

    const llm = new LlmAdapter(this.llmProvider, modelId);
    const signal = this.acquireSignal(run.runId);
    const messageId = params.messageId;

    const ctx: AgentRunContext = {
      run,
      config,
      agentId: params.agentBinding.agentId,
      runId: run.runId,
      workDir: params.workDir,
      signal,
      llm,
      cache: this.cacheService,
      buildContext: () => memory.buildContext(),
      contextUsage: () => memory.getContextUsage(),
      executeTool: (toolName, args) =>
        this.executeTool(toolName, args, {
          signal,
          workDir: params.workDir,
          runId: run.runId,
          llm,
          cache: this.cacheService,
          messageId,
        }),
    };

    return { run, ctx };
  }

  /** 驱动 agent.call，append 事实 + yield 富化事件给传输 */
  async *execute(
    run: AgentRun,
    ctx: AgentRunContext,
  ): AsyncGenerator<EnrichedEvent> {
    const agent = container.resolve<Agent>(run.agentId);
    yield run.start();

    try {
      for await (const event of agent.call(ctx)) {
        const enriched = run.append(event);
        if (enriched) yield enriched;
      }

      if (!run.isTerminated) {
        const { used, total } = ctx.contextUsage();
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
      yield run.fail((err as Error)?.message ?? String(err));
    } finally {
      this.releaseSignal(run.runId);
    }
  }

  /** 取消：abort + 记录 cancelled 事件，返回富化事件供调用方推送 SSE */
  cancel(run: AgentRun, reason: string): EnrichedEvent | null {
    this.abortControllers.get(run.runId)?.abort(reason);
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

  private acquireSignal(runId: string): AbortSignal {
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    return controller.signal;
  }

  private releaseSignal(runId: string): void {
    this.abortControllers.delete(runId);
  }
}
