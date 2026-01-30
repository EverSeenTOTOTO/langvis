import type { Logger } from '@/server/utils/logger';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { Memory } from '../memory';

export abstract class Agent {
  abstract readonly id: string;
  abstract readonly config: AgentConfig;

  protected abstract readonly logger: Logger;

  async getSystemPrompt(): Promise<string> {
    return '';
  }

  async call(_memory: Memory, _config?: any): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Non-streaming call not implemented.`,
    );
  }

  async streamCall(
    _memory: Memory,
    _outputWriter: WritableStreamDefaultWriter<StreamChunk>,
    _config?: any,
  ): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Streaming call not implemented.`,
    );
  }
}

export type AgentConstructor = new () => Agent;
