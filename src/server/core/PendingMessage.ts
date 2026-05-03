import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';

export class PendingMessage {
  constructor(private message: Message) {}

  handleEvent(event: AgentEvent): void {
    if (event.type === 'stream') {
      this.message.content += event.content;
      return;
    }

    if (event.type === 'error') {
      this.message.content = event.error;
    }

    if (event.type === 'cancelled') {
      this.message.content = event.reason;
    }

    if (
      (event as Extract<AgentEvent, { type: 'tool_call' }>).toolName !==
      ToolIds.LLM_CALL
    ) {
      if (!this.message.events) {
        this.message.events = [];
      }
      this.message.events.push(event);
    }
  }

  get contentLength(): number {
    return this.message.content.length;
  }

  toMessage(): Message {
    return this.message;
  }

  get events(): AgentEvent[] {
    return this.message.events ?? [];
  }
}
