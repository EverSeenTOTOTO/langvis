import { TraceContext } from '../TraceContext';
import { Logger } from '@/server/utils/logger';
import { Message } from '@/shared/entities/Message';

export abstract class Memory {
  protected abstract readonly logger: Logger;

  get conversationId(): string | undefined {
    return TraceContext.get()?.conversationId;
  }

  get userId(): string | undefined {
    return TraceContext.get()?.userId;
  }

  abstract store(_memory: any): Promise<void>;

  abstract retrieve(_fact: any): Promise<any>;

  abstract clearByConversationId(_conversationId: string): Promise<void>;

  abstract clearByUserId(_userId: string): Promise<void>;

  abstract summarize(): Promise<Message[]>;
}
