import { globby } from 'globby';
import path from 'path';
import { container, inject } from 'tsyringe';
import type { AgentBinding, AgentConfig } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type { AgentConstructor } from '../../domain/model/agent.base';
import type { Agent } from '../../domain/model/agent.base';
import { AgentRun } from '../../domain/model/agent-run.entity';
import { EffectiveConfig } from '../../domain/model/effective-config';
import { registerAgent } from '@/server/decorator/core';
import { service } from '@/server/decorator/service';
import { ToolService } from './tool.service';
import { SkillService } from './skill.service';
import { LlmAdapter } from '../../infrastructure/llm.adapter';
import { LlmProvider } from '@/server/modules/memory/infrastructure/llm.provider';
import { MEMORY_FACTORY } from '@/server/modules/memory/memory.di-tokens';
import {
  MemoryFactory,
  type MemoryType,
} from '@/server/modules/memory/application/service/memory-factory';
import { CACHE_SERVICE } from '../../agent.di-tokens';
import type { CachePort } from '../../domain/port/cache.port';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { isProd } from '@/server/utils';
import Logger from '@/server/utils/logger';

@service()
export class AgentService {
  private agents: string[] = [];
  private isInitialized = false;

  private readonly logger = Logger.child({ source: 'AgentService' });

  constructor(
    @inject(ToolService)
    private toolService: ToolService,
    @inject(SkillService)
    private skillService: SkillService,
    @inject(LlmProvider)
    private llmService: LlmProvider,
    @inject(MEMORY_FACTORY)
    private memoryFactory: MemoryFactory,
    @inject(CACHE_SERVICE)
    private cacheService: CachePort,
    @inject(ProviderService)
    private providerService: ProviderService,
  ) {
    Promise.all([
      this.toolService.initialize(),
      this.skillService.initialize(),
    ]).then(() => {
      this.initialize();
    });
  }

  async getAllAgentInfo() {
    await this.initialize();
    return this.agents.map(agent => ({
      id: agent,
      ...container.resolve<any>(agent)?.config,
    }));
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

    try {
      await this.toolService.getAllToolInfo();

      const agents = await this.discoverAgents();

      this.logger.info(
        `Discovered ${agents.length} agents:`,
        agents.map(a => a.clazz.name),
      );

      this.agents = await Promise.all(
        agents.map(agent => registerAgent(agent.clazz, agent.config)),
      );
    } catch (e) {
      this.isInitialized = false;
      this.logger.error('Failed to initialize AgentService:', e);
    }
  }

  private async discoverAgents() {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/modules/agent/implementations/agents/*/index${suffix}`;

    const agentPaths = await globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    });

    const agents: {
      clazz: AgentConstructor;
      config: AgentConfig;
    }[] = [];

    for (const absolutePath of agentPaths) {
      try {
        const configPath = path.resolve(
          path.dirname(absolutePath),
          `config${suffix}`,
        );

        const [{ default: clazz }, { config }] = await Promise.all([
          import(absolutePath),
          import(configPath),
        ]);

        if (clazz && config) {
          agents.push({
            clazz,
            config,
          });
        } else {
          this.logger.warn(
            `Incomplete agent module at ${path.basename(absolutePath, suffix)}`,
          );
        }
      } catch (error) {
        Logger.error(`Failed to process agent module ${absolutePath}:`, error);
      }
    }

    return agents;
  }

  buildSystemPrompt(agentId: string): string {
    const agent = container.resolve<Agent>(agentId);
    return agent.systemPrompt.build();
  }

  createRun(params: {
    runId: string;
    messageId: string;
    workDir: string;
    agentBinding: AgentBinding;
    systemPrompt: string;
    historyMessages: Message[];
  }): AgentRun {
    const agent = container.resolve<Agent>(params.agentBinding.agentId);

    const cfg = params.agentBinding.config as {
      model?: { modelId?: string };
      memory?: { type?: string; windowSize?: number };
    };
    const modelId = cfg.model?.modelId;
    const contextSize = modelId
      ? (this.providerService.getModel(modelId)?.contextSize ?? 128_000)
      : 128_000;

    const effectiveConfig = EffectiveConfig.create(
      agent.config,
      params.agentBinding,
      params.systemPrompt,
      contextSize,
    );

    const memory = this.memoryFactory.create({
      history: params.historyMessages,
      systemPrompt: effectiveConfig.systemPrompt,
      contextSize: effectiveConfig.contextSize,
      modelId: cfg.model?.modelId ?? '',
      memoryType: (cfg.memory?.type ?? 'slide_window_memory') as MemoryType,
      windowSize: cfg.memory?.windowSize,
    });

    const llm = new LlmAdapter(this.llmService, modelId);

    return new AgentRun(
      params.runId,
      params.messageId,
      params.workDir,
      effectiveConfig,
      agent,
      memory,
      this.cacheService,
      llm,
    );
  }
}
