import { Logger } from '@/server/utils/logger';
import { Message } from '@/shared/entities/Message';

export abstract class Memory {
  protected abstract readonly logger: Logger;

  abstract conversationId?: string;
  abstract userId?: string;

  setConversationId(conversationId: string) {
    this.conversationId = conversationId;
  }

  setUserId(userId: string) {
    this.userId = userId;
  }

  abstract store(_memory: any): Promise<void>;

  abstract retrieve(_fact: any): Promise<any>;

  abstract clearByConversationId(_conversationId: string): Promise<void>;

  abstract clearByUserId(_userId: string): Promise<void>;

  abstract summarize(): Promise<Message[]>;
}
