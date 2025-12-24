import type { Message } from '@/shared/entities/Message';
import { StreamChunk, AgentConfig } from '@/shared/types';

/* eslint-disable @typescript-eslint/no-unused-vars */
export abstract class Agent {
  abstract id: string;
  abstract config: AgentConfig;

  async getSystemPrompt(): Promise<string> {
    return '';
  }

  async call(
    _messages: Message[],
    _config?: Record<string, any>,
  ): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Non-streaming call not implemented.`,
    );
  }

  async streamCall(
    _messages: Message[],
    _outputStream: WritableStream<StreamChunk>,
    _config?: Record<string, any>,
  ): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Streaming call not implemented.`,
    );
  }
}

export type AgentConstructor = new () => Agent;
