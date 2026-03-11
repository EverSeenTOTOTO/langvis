import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';

export type MessagePersister = (message: Message) => Promise<unknown>;

export class PendingMessage {
  constructor(
    private message: Message,
    private persistCallback: MessagePersister,
  ) {}

  handleEvent(event: AgentEvent): void {
    // 1. Accumulate stream content to message
    if (event.type === 'stream') {
      this.message.content += event.content;
      return;
    }

    // 2. Special handling for error event - set content
    if (event.type === 'error') {
      this.message.content = event.error;
    }

    // 3. Persist non-stream and non-llm events to message.meta.events
    if (
      (event as Extract<AgentEvent, { type: 'tool_call' }>).toolName !==
      ToolIds.LLM_CALL
    ) {
      if (!this.message.meta) {
        this.message.meta = {};
      }
      if (!this.message.meta.events) {
        this.message.meta.events = [];
      }
      this.message.meta.events.push(event);
    }
  }

  get contentLength(): number {
    return this.message.content.length;
  }

  async persist(): Promise<void> {
    await this.persistCallback(this.message);
  }

  toMessage(): Message {
    return this.message;
  }
}
