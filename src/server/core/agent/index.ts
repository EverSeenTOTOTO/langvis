import type { Logger } from '@/server/utils/logger';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { ExecutionContext } from '../ExecutionContext';
import { Memory } from '../memory';
import { Prompt } from '../PromptBuilder';
import { Tool } from '../tool';

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly config: AgentConfig;

  protected abstract readonly logger: Logger;

  abstract readonly tools: Tool[];

  get systemPrompt(): Prompt {
    return Prompt.empty();
  }

  abstract call(
    memory: Memory,
    ctx: ExecutionContext,
    config?: unknown,
  ): AsyncGenerator<AgentEvent, void, void>;
}

export type AgentConstructor = new (...args: any[]) => Agent;
