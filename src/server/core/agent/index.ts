import type { ChatState } from '../ChatState';

export interface Agent {
  getSystemPrompt?(): Promise<string>;

  call(chatState: ChatState): Promise<unknown>;

  streamCall(
    chatState: ChatState,
    outputStream: WritableStream,
  ): Promise<unknown>;
}

export type AgentConstructor = (new () => Agent) & {
  Name: string;
  Description: string;
};
