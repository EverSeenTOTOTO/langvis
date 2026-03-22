import { memory } from '@/server/decorator/core';
import { Logger } from '@/server/utils/logger';
import { MemoryIds } from '@/shared/constants';
import { Message, Role } from '@/shared/types/entities';
import { Memory, InitializeInput } from '..';

@memory(MemoryIds.CHILD)
export default class ChildMemory extends Memory {
  protected readonly logger!: Logger;

  private messages: Message[] = [];
  private initialized = false;

  async initialize(input: InitializeInput): Promise<void> {
    if (this.initialized) {
      this.logger.warn('ChildMemory already initialized, skipping');
      return;
    }

    const baseTime = Date.now();
    let index = 0;

    // 1. System prompt
    if (input.systemPrompt) {
      this.messages.push({
        id: '',
        role: Role.SYSTEM,
        content: input.systemPrompt,
        attachments: null,
        meta: null,
        createdAt: new Date(baseTime + index++),
        conversationId: '',
      });
    }

    // 2. Context
    if (input.context) {
      this.messages.push({
        id: '',
        role: Role.USER,
        content: input.context,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + index++),
        conversationId: '',
      });
    }

    // 3. User message
    this.messages.push({
      id: '',
      ...input.userMessage,
      createdAt: new Date(baseTime + index++),
      conversationId: '',
    });

    this.initialized = true;
    this.logger.debug('ChildMemory initialized', {
      messageCount: this.messages.length,
    });
  }

  async store(messages: Message[]): Promise<void> {
    this.messages.push(...messages);
  }

  async retrieve(): Promise<Message[]> {
    return [...this.messages];
  }

  async summarize(): Promise<Message[]> {
    return [...this.messages];
  }
}
