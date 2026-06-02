import type { Message } from '@/shared/types/entities';
import type { MessageAttachment } from '@/shared/types/entities';
import type { ToolCallRecord } from '@/shared/types/render';
import { Role } from '@/shared/types/entities';

export interface MessageRepositoryPort {
  batchCreate(
    conversationId: string,
    messagesData: Array<{
      id?: string;
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ): Promise<Message[]>;

  findLastAssistantMessage(conversationId: string): Promise<Message | null>;

  findActiveAssistantMessages(conversationId: string): Promise<Message[]>;

  findByConversationId(conversationId: string): Promise<Message[]>;

  save(message: Message): Promise<Message>;

  batchDeleteInConversation(
    conversationId: string,
    messageIds?: string[],
  ): Promise<void>;

  update(messageId: string, partial: Partial<Message>): Promise<Message | null>;

  appendToolCallRecord(
    messageId: string,
    record: ToolCallRecord,
  ): Promise<void>;

  appendThought(messageId: string, thought: string): Promise<void>;

  deleteAfter(conversationId: string, afterMessageId: string): Promise<boolean>;
}
