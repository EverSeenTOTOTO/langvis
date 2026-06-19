import type { Message } from '@/shared/types/entities';
import type { MessageAttachment } from '@/shared/types/entities';
import { MessageEntity, Role } from '@/shared/entities/Message';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { inject, singleton } from 'tsyringe';
import { In } from 'typeorm';

@singleton()
export class MessageRepository implements MessageRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async batchCreate(
    conversationId: string,
    messagesData: Array<{
      id?: string;
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ): Promise<Message[]> {
    const repo = this.db.getRepository(MessageEntity);
    const messages = messagesData.map(data =>
      repo.create({
        ...(data.id && { id: data.id }),
        conversationId,
        role: data.role,
        content: data.content,
        attachments: data.attachments,
        meta: data.meta,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }),
    );
    return await repo.save(messages);
  }

  async findLastAssistantMessage(
    conversationId: string,
  ): Promise<Message | null> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.findOne({
      where: { conversationId, role: Role.ASSIST },
      order: { createdAt: 'DESC' },
    });
  }

  async findByConversationId(conversationId: string): Promise<Message[]> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async save(message: Message): Promise<Message> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.save(message as MessageEntity);
  }

  async batchDeleteInConversation(
    conversationId: string,
    messageIds?: string[],
  ): Promise<void> {
    const repo = this.db.getRepository(MessageEntity);
    if (!messageIds || messageIds.length === 0) {
      await repo.delete({ conversationId });
    } else {
      await repo.delete({ conversationId, id: In(messageIds) });
    }
  }

  async update(
    messageId: string,
    partial: Partial<Message>,
  ): Promise<Message | null> {
    const repo = this.db.getRepository(MessageEntity);
    const message = await repo.findOneBy({ id: messageId });
    if (!message) return null;
    Object.assign(message, partial);
    return await repo.save(message);
  }

  async deleteAfter(
    conversationId: string,
    afterMessageId: string,
  ): Promise<boolean> {
    const repo = this.db.getRepository(MessageEntity);
    const targetMessage = await repo.findOneBy({
      id: afterMessageId,
      conversationId,
    });
    if (!targetMessage) return false;

    await repo
      .createQueryBuilder()
      .delete()
      .from(MessageEntity)
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('createdAt > :createdAt', {
        createdAt: targetMessage.createdAt,
      })
      .execute();
    return true;
  }
}
