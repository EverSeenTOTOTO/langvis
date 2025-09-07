import type { Conversation } from '@/shared/entities/Conversation';

export type AgentCallContext = {
  readonly conversationId: Conversation['id'];
};

export type AgentStreamCallContext = AgentCallContext & {
  outputStream: WritableStream;
};

export interface Agent {
  call(ctx: AgentCallContext, input: Record<string, any>): Promise<unknown>;

  streamCall(
    ctx: AgentStreamCallContext,
    input: Record<string, any>,
  ): Promise<unknown>;
}
