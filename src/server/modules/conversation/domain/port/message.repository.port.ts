import type { Message } from '@/shared/types/entities';
import type { MessageAttachment } from '@/shared/types/entities';
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

  findById(messageId: string): Promise<Message | null>;

  findByConversationId(conversationId: string): Promise<Message[]>;

  /** 按 agentRunId 批量查消息（启动清扫：定位非终态 run 的 assistant 消息）。 */
  findByAgentRunIds(runIds: string[]): Promise<Message[]>;

  save(message: Message): Promise<Message>;

  batchDeleteInConversation(
    conversationId: string,
    messageIds?: string[],
  ): Promise<void>;

  update(messageId: string, partial: Partial<Message>): Promise<Message | null>;

  deleteAfter(conversationId: string, afterMessageId: string): Promise<boolean>;
}
