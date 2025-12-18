import type { Message } from '@/shared/entities/Message';

export interface Agent {
  name: string;
  description: string;

  getSystemPrompt?(): Promise<string>;

  call(messages: Message[], config?: Record<string, any>): Promise<unknown>;

  streamCall(
    messages: Message[],
    outputStream: WritableStream,
    config?: Record<string, any>,
  ): Promise<unknown>;
}

export type AgentConstructor = new () => Agent;
