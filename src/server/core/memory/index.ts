import { Logger } from '@/server/utils/logger';
import { Message } from '@/shared/entities/Message';

export interface InitializeInput {
  systemPrompt?: string;
  context?: string;
  userMessage: Omit<Message, 'id' | 'conversationId' | 'createdAt'>;
}

export abstract class Memory {
  protected abstract readonly logger: Logger;

  abstract initialize(input: InitializeInput): Promise<void>;

  abstract store(messages: Message[]): Promise<void>;

  abstract retrieve(): Promise<Message[]>;

  abstract summarize(): Promise<Message[]>;
}
