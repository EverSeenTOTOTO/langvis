import { Logger } from '@/server/utils/logger';
import { Message } from '@/shared/entities/Message';

export interface ContextUsage {
  used: number;
  total: number;
}

export abstract class Memory {
  protected readonly logger!: Logger;
  protected windowSize: number = Number.MAX_SAFE_INTEGER;

  private context: Message[] = [];

  setWindowSize(size: number): void {
    this.windowSize = size;
  }

  setContext(messages: Message[]): void {
    this.context = messages;
  }

  protected getContext(): Message[] {
    return this.context;
  }

  async summarize(): Promise<Message[]> {
    return this.context;
  }

  async completeTurn(_currentMessage?: Message): Promise<void> {}

  async notifyContextUsage(_usage: ContextUsage): Promise<void> {}
}
