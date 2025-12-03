import type { Message } from '@/shared/entities/Message';

export interface Agent {
  getSystemPrompt?(): Promise<string>;

  call(messages: Message[]): Promise<unknown>;

  streamCall(
    messages: Message[],
    outputStream: WritableStream,
  ): Promise<unknown>;
}

export type AgentConstructor = (new () => Agent) & {
  Name: string;
  Description: string;
};
