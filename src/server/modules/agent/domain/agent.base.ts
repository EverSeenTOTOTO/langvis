import type { Logger } from '@/server/utils/logger';
import type { AgentConfig } from '@/shared/types';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import { Prompt } from '@/server/core/PromptBuilder';
import type { Tool } from '@/server/modules/agent/domain/tool.base';
import type { AgentRun } from './agent-run.entity';

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly config: AgentConfig;

  protected abstract readonly logger: Logger;

  abstract readonly tools: Tool[];

  get systemPrompt(): Prompt {
    return Prompt.empty();
  }

  abstract call(
    run: AgentRun,
  ): AsyncGenerator<AgentEvent | StreamChunk, void, void>;
}

export type AgentConstructor = new (...args: any[]) => Agent;
