import type { EffectiveConfig } from '@/shared/types/agent';
import type { Message } from '@/shared/types/entities';
import { inject, singleton } from 'tsyringe';
import type { Agent } from '../domain/agent.base';
import { AgentRun } from '../domain/agent-run.entity';
import { ChatLlmAdapter } from './chat-llm.adapter';
import { LlmService } from '@/server/modules/memory/adapters/llm.adapter';
import { MemoryService } from '@/server/modules/memory/domain/memory-service';
import { CacheService } from '@/server/modules/memory/adapters/cache.adapter';

@singleton()
export class AgentRunFactory {
  constructor(
    @inject(LlmService) private readonly llmService: LlmService,
    @inject(MemoryService) private readonly memoryService: MemoryService,
    @inject(CacheService) private readonly cacheService: CacheService,
  ) {}

  create(
    runId: string,
    messageId: string,
    config: EffectiveConfig,
    agent: Agent,
    historyMessages: Message[],
  ): AgentRun {
    const cfg = config.runtimeConfig as { model?: { modelId?: string } };
    const chatLlm = new ChatLlmAdapter(this.llmService, cfg.model?.modelId);

    return new AgentRun(
      runId,
      messageId,
      config,
      agent,
      this.memoryService,
      this.cacheService,
      chatLlm,
      historyMessages,
    );
  }
}
