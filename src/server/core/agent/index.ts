import type { Logger } from '@/server/utils/logger';
import { AgentConfig, AgentEvent } from '@/shared/types';
import { Memory } from '../memory';

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly config: AgentConfig;

  protected abstract readonly logger: Logger;

  async getSystemPrompt(): Promise<string> {
    return '';
  }

  abstract call(
    memory: Memory,
    config?: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, void, void>;
}

export type AgentConstructor = new (...args: any[]) => Agent;
