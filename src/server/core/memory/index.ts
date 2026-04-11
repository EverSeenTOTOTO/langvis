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

  /**
   * Set the context messages for this turn.
   * Called by ChatService before agent execution.
   * This replaces the old initialize/retrieve flow —
   * the caller constructs messages, Memory just holds and summarizes them.
   */
  setContext(messages: Message[]): void {
    this.context = messages;
  }

  /** Get current context messages */
  protected getContext(): Message[] {
    return this.context;
  }

  /**
   * Assemble runtime context for the LLM.
   * Default implementation returns context as-is (full history).
   * Subclasses can override to compress/filter.
   */
  async summarize(): Promise<Message[]> {
    return this.context;
  }

  async onTurnComplete(): Promise<void> {}

  async onContextUsageChange(_usage: ContextUsage): Promise<void> {}
}
