import type { Logger } from '@/server/utils/logger';
import type { AgentConfig } from '@/shared/types';
import { Prompt } from '@/server/modules/agent/domain/model/prompt';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { AgentRunContext } from '../port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly config: AgentConfig;

  protected abstract readonly logger: Logger;

  abstract readonly tools: Tool[];

  get systemPrompt(): Prompt {
    return Prompt.empty();
  }

  abstract call(ctx: AgentRunContext): AsyncGenerator<RunEvent, void, void>;
}

export type AgentConstructor = new (...args: any[]) => Agent;
