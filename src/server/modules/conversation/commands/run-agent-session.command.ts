import type { Message } from '@/shared/types/entities';
import type { AgentBinding } from '@/shared/types/agent';
import type { Agent } from '@/server/modules/agent/domain/agent.base';
import { Command } from '@/server/libs/ddd';

export class RunAgentSessionCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly agent: Agent,
    readonly messages: Message[],
    readonly assistantMessage: Message,
    readonly binding: AgentBinding,
  ) {
    super();
  }
}
